"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { server: WebSocketServer } = require("websocket");
const speech = require('@google-cloud/speech');
const { DialogflowCXService } = require('./dialogflow-service');
const textToSpeech = require('@google-cloud/text-to-speech');

const app = express();
const HTTP_SERVER_PORT = process.env.PORT || 8081;

// Create Google Speech client
const speechClient = new speech.SpeechClient();

// Create an HTTP server and bind it to Express
const server = http.createServer(app);

// WebSocket server over the same HTTP server
const mediaws = new WebSocketServer({
  httpServer: server,
  autoAcceptConnections: true,
});

// Common languages for auto-detection attempts
const DETECTION_LANGUAGES = [
  'en-US',  // English (US)
  'es-ES',  // Spanish
  'fr-FR',  // French
  'de-DE',  // German
  'it-IT',  // Italian
  'pt-BR',  // Portuguese
  'zh-CN',  // Chinese
  'ja-JP',  // Japanese
  'hi-IN',  // Hindi
];

const LANGUAGE_NAMES = {
  'en-US': 'English (US)', 'en-GB': 'English (UK)', 'en-AU': 'English (Australia)',
  'es-ES': 'Spanish', 'es-MX': 'Spanish (Mexico)',
  'fr-FR': 'French', 'de-DE': 'German', 'it-IT': 'Italian',
  'pt-BR': 'Portuguese', 'zh-CN': 'Chinese', 'ja-JP': 'Japanese',
  'ko-KR': 'Korean', 'hi-IN': 'Hindi', 'ar-SA': 'Arabic'
};

function log(message, ...args) {
  console.log(`[${new Date().toISOString()}] ${message}`, ...args);
}

function logTranscript(text, type = 'FINAL', confidence = null, language = null) {
  const timestamp = new Date().toISOString();
  const confidenceStr = confidence ? ` (${(confidence * 100).toFixed(1)}%)` : '';
  const languageStr = language ? ` [${LANGUAGE_NAMES[language] || language}]` : '';
  
  if (type === 'FINAL') {
    console.log(`\n🎙️  [${timestamp}] TRANSCRIPT${languageStr}: "${text}"${confidenceStr}`);
  } else if (type === 'INTERIM') {
    console.log(`💭 [${timestamp}] INTERIM${languageStr}: "${text}"`);
  } else if (type === 'LANGUAGE_DETECTED') {
    console.log(`🌍 [${timestamp}] LANGUAGE DETECTED: ${LANGUAGE_NAMES[language] || language}`);
  }
}

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Fixed Phone Call Model Transcription Server is running!");
});

app.get("/ping", (req, res) => {
  res.send("Phone call transcription ready!");
});

// TwiML endpoint
app.post("/twiml", (req, res) => {
  log("POST TwiML - Setting up phone call transcription");

  const filePath = path.join(__dirname, "templates", "streams.xml");

  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.status(500).send("Error reading TwiML file");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/xml",
      "Content-Length": stat.size,
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  });
});

// WebSocket handling
mediaws.on("connect", function (connection) {
  log("📞 New call connected - Starting phone call transcription");
  console.log("=" .repeat(80));
  new PhoneCallTranscriptionStream(connection);
});

class PhoneCallTranscriptionStream {
  constructor(connection) {
    this.connection = connection;
    this.hasSeenMedia = false;
    this.messageCount = 0;
    this.callId = null;
    this.streamSid = null;
    
    // Audio processing
    this.audioBuffer = [];
    this.transcriptBuffer = [];
    this.startTime = new Date();
    
    // Language detection approach
    this.currentLanguage = 'en-US';  // Start with English
    this.languageIndex = 0;
    this.detectionAttempts = 0;
    this.maxDetectionAttempts = 3;
    this.isLanguageConfirmed = false;
    this.noTranscriptCount = 0;
    
    // Google Speech streaming config
    this.speechStream = null;
    this.isStreamingActive = false;
    
    // Console formatting
    this.interimCounter = 0;
    
    // Bind event handlers
    connection.on("message", this.processMessage.bind(this));
    connection.on("close", this.close.bind(this));
    
    this.setupSpeechStream();
    
    // Add these new properties
    this.dialogflowService = new DialogflowCXService();
    this.ttsClient = new textToSpeech.TextToSpeechClient();
    this.sessionId = this.generateSessionId();
  }

  setupSpeechStream(languageCode = 'en-US') {
    log(`🔧 Setting up speech stream for ${LANGUAGE_NAMES[languageCode] || languageCode}...`);
    
    // Close existing stream if any
    if (this.speechStream) {
      this.speechStream.end();
    }
    
    const request = {
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000,
        audioChannelCount: 1,
        
        // Single language - NO alternativeLanguageCodes for phone_call model
        languageCode: languageCode,
        
        // Phone call optimization
        model: 'phone_call',
        useEnhanced: true,
        
        // Features
        enableAutomaticPunctuation: true,
        interimResults: true,
        enableWordConfidence: true,
      },
      interimResults: true,
    };

    this.speechStream = speechClient
      .streamingRecognize(request)
      .on('error', (error) => {
        console.error(`❌ Speech recognition error for ${languageCode}:`, error.message);
        this.handleLanguageDetectionFailure();
      })
      .on('data', (data) => {
        this.handleSpeechResult(data);
      });

    this.isStreamingActive = true;
    this.currentLanguage = languageCode;
    
    log(`✅ Speech stream active for ${LANGUAGE_NAMES[languageCode] || languageCode}`);
  }

  tryNextLanguage() {
    if (this.isLanguageConfirmed) return;
    
    this.languageIndex = (this.languageIndex + 1) % DETECTION_LANGUAGES.length;
    this.detectionAttempts++;
    
    if (this.detectionAttempts >= this.maxDetectionAttempts) {
      log("⚠️  Language detection attempts exhausted - sticking with English");
      this.confirmLanguage('en-US');
      return;
    }
    
    const nextLanguage = DETECTION_LANGUAGES[this.languageIndex];
    log(`🔄 Trying next language: ${LANGUAGE_NAMES[nextLanguage] || nextLanguage}`);
    
    // Restart with new language after a short delay
    setTimeout(() => {
      this.setupSpeechStream(nextLanguage);
    }, 1000);
  }

  handleLanguageDetectionFailure() {
    if (!this.isLanguageConfirmed) {
      log("❌ Language detection failed, trying next language...");
      this.tryNextLanguage();
    } else {
      // If already confirmed, just restart with same language
      setTimeout(() => {
        this.setupSpeechStream(this.currentLanguage);
      }, 1000);
    }
  }

  processMessage(message) {
    if (message.type === "utf8") {
      const data = JSON.parse(message.utf8Data);
      
      if (data.event === "connected") {
        log("🔗 WebSocket connected");
      }
      
      if (data.event === "start") {
        this.callId = data.start.callSid;
        this.streamSid = data.start.streamSid;
        console.log(`\n📋 CALL STARTED`);
        console.log(`   Call ID: ${this.callId}`);
        console.log(`   Stream ID: ${this.streamSid}`);
        console.log(`   Time: ${new Date().toLocaleString()}`);
        console.log(`\n🌍 Auto-detecting language (trying ${DETECTION_LANGUAGES.length} languages)...`);
        console.log("-" .repeat(80));
      }
      
      if (data.event === "media") {
        this.processAudioData(data.media);
        
        if (!this.hasSeenMedia) {
          log("🎙️  First audio received - Language detection started");
          this.hasSeenMedia = true;
        }
      }
      
      if (data.event === "stop") {
        log("🛑 Call ended");
        this.finalizeSpeechStream();
      }
      
      this.messageCount++;
    }
  }

  processAudioData(mediaData) {
    try {
      const audioChunk = Buffer.from(mediaData.payload, 'base64');
      
      // Send to Google Speech
      if (this.speechStream && this.isStreamingActive) {
        this.speechStream.write(audioChunk);
      }
      
      // Store for metrics
      this.audioBuffer.push({
        timestamp: mediaData.timestamp,
        chunk: mediaData.chunk,
        size: audioChunk.length
      });
      
    } catch (error) {
      console.error('❌ Error processing audio:', error.message);
    }
  }

  handleSpeechResult(data) {
    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      
      if (result.alternatives && result.alternatives[0]) {
        const alternative = result.alternatives[0];
        const transcript = alternative.transcript ? alternative.transcript.trim() : '';
        
        if (transcript) {
          // We got a transcript! This language is working
          if (!this.isLanguageConfirmed) {
            this.confirmLanguage(this.currentLanguage);
          }
          
          const confidence = alternative.confidence;
          const isFinal = result.isFinal;
          
          if (isFinal) {
            logTranscript(transcript, 'FINAL', confidence, this.currentLanguage);
            
            // ADD THIS LINE - Process the final transcript
            this.handleFinalTranscript(transcript);
            
            this.transcriptBuffer.push({
              text: transcript,
              confidence: confidence,
              language: this.currentLanguage,
              timestamp: new Date()
            });
            
            this.interimCounter = 0;
            this.noTranscriptCount = 0;  // Reset no transcript counter
            
          } else {
            this.interimCounter++;
            if (this.interimCounter % 3 === 0) {
              logTranscript(transcript, 'INTERIM', null, this.currentLanguage);
            }
          }
        } else {
          // No transcript received
          this.noTranscriptCount++;
          
          // If we haven't confirmed language and no transcripts for a while, try next language
          if (!this.isLanguageConfirmed && this.noTranscriptCount > 20) {
            log(`⚠️  No transcripts for ${LANGUAGE_NAMES[this.currentLanguage]}, trying next language...`);
            this.noTranscriptCount = 0;
            this.tryNextLanguage();
          }
        }
      }
    }
  }

  confirmLanguage(language) {
    if (this.isLanguageConfirmed) return;
    
    this.isLanguageConfirmed = true;
    this.currentLanguage = language;
    
    logTranscript('', 'LANGUAGE_DETECTED', null, language);
    console.log(`\n🎯 LANGUAGE CONFIRMED: ${LANGUAGE_NAMES[language] || language}`);
    console.log(`✅ Continuing transcription...`);
    console.log("-" .repeat(80));
  }

  finalizeSpeechStream() {
    console.log("\n" + "=" .repeat(80));
    log("📝 Finalizing transcription...");
    
    if (this.speechStream && this.isStreamingActive) {
      this.speechStream.end();
      this.isStreamingActive = false;
    }
    
    // Calculate metrics
    const duration = (new Date() - this.startTime) / 1000;
    const totalAudioData = this.audioBuffer.reduce((sum, chunk) => sum + chunk.size, 0);
    const finalTranscripts = this.transcriptBuffer.map(t => t.text).join(' ');
    
    // Print final summary
    console.log(`\n📊 CALL SUMMARY`);
    console.log(`   Call ID: ${this.callId}`);
    console.log(`   Duration: ${duration.toFixed(1)} seconds`);
    console.log(`   Language: ${LANGUAGE_NAMES[this.currentLanguage] || this.currentLanguage || 'Not detected'}`);
    console.log(`   Detection attempts: ${this.detectionAttempts}`);
    console.log(`   Audio chunks: ${this.audioBuffer.length}`);
    console.log(`   Audio data: ${(totalAudioData / 1024).toFixed(1)} KB`);
    console.log(`   Transcripts: ${this.transcriptBuffer.length} segments`);
    
    if (finalTranscripts) {
      console.log(`\n📝 COMPLETE TRANSCRIPT:`);
      console.log(`"${finalTranscripts}"`);
      
      // Show confidence breakdown
      const avgConfidence = this.transcriptBuffer
        .filter(t => t.confidence)
        .reduce((sum, t, _, arr) => sum + t.confidence / arr.length, 0);
      
      if (avgConfidence > 0) {
        console.log(`📈 Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
      }
      
      const wordCount = finalTranscripts.split(' ').length;
      console.log(`📊 Word count: ${wordCount} words`);
      
    } else {
      console.log(`\n⚠️  No speech detected in this call`);
    }
    
    console.log("\n" + "=" .repeat(80));
  }

  async handleFinalTranscript(transcript) {
    try {
      console.log(`🤖 Sending to Dialogflow: "${transcript}"`);
      
      // Send to Dialogflow
      const dialogflowResponse = await this.dialogflowService.sendMessage(
        transcript, 
        this.sessionId
      );
      
      if (dialogflowResponse.success && dialogflowResponse.messages.length > 0) {
        const responseText = dialogflowResponse.messages[0];
        console.log(`🎯 AI Response: "${responseText}"`);
        
        // Convert to speech and send back
        await this.sendAudioResponse(responseText);
      }
    } catch (error) {
      console.error('❌ Error processing transcript:', error);
    }
  }

  async sendAudioResponse(text) {
    try {
      // Generate TTS
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text: text },
        voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
        audioConfig: { 
          audioEncoding: 'MULAW',
          sampleRateHertz: 8000
        }
      });

      // Convert to base64 and send back to Twilio
      const audioBase64 = response.audioContent.toString('base64');
      
      // Send audio back through WebSocket
      const mediaMessage = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: audioBase64
        }
      };
      
      this.connection.send(JSON.stringify(mediaMessage));
      console.log(`🔊 Sent audio response back to caller`);
      
    } catch (error) {
      console.error('❌ Error generating/sending audio response:', error);
    }
  }

  // Add session ID generator
  generateSessionId() {
    return `call_${this.callId || Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  close() {
    log(`📞 Call disconnected. Processed ${this.messageCount} messages`);
    this.finalizeSpeechStream();
  }
}

// Start the server
server.listen(HTTP_SERVER_PORT, "0.0.0.0", () => {
  console.log("🔧 PHONE CALL MODEL TRANSCRIPTION SERVER");
  console.log("=" .repeat(60));
  console.log(`🌐 Server: http://0.0.0.0:${HTTP_SERVER_PORT}`);
  console.log(`📝 Mode: Phone call optimized (no alternative languages)`);
  console.log(`🌍 Auto-detection: Sequential language testing`);
  console.log(`🔧 Google Speech: ${speechClient ? 'Ready' : 'Not configured'}`);
  console.log(`⏰ Started: ${new Date().toLocaleString()}`);
  console.log("=" .repeat(60));
  console.log(`📞 Waiting for Twilio calls...`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Server shutting down...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});