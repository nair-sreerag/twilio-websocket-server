"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { server: WebSocketServer } = require("websocket");
const speech = require('@google-cloud/speech');
const { DialogflowCXService } = require('./dialogflow-service'); // Import the service

const app = express();
const HTTP_SERVER_PORT = process.env.PORT || 8081;

// Add express middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Create Google Speech client
const speechClient = new speech.SpeechClient();

// Initialize DialogFlow service
const dialogflowService = new DialogflowCXService();

// Create an HTTP server and bind it to Express
const server = http.createServer(app);

// WebSocket server over the same HTTP server
const mediaws = new WebSocketServer({
  httpServer: server,
  autoAcceptConnections: true,
});

// Store active calls
const activeCalls = new Map();

class AudioBuffer {
  constructor() {
    this.audioChunks = [];
    this.processingInterval = null;
    this.processingIntervalTime = 4000;
    this.isRecording = false;
    this.lastProcessTime = 0;
    this.chunkCount = 0;
    this.minChunksBeforeProcessing = 100;
    
    // Session identifiers
    this.sessionId = null;
    this.callSid = null;
    this.streamSid = null;
    this.accountSid = null;
    this.fromNumber = null;
    this.toNumber = null;
    this.fromCountry = null;
    this.toCountry = null;
    this.fromLocation = null;
    this.sessionStartTime = null;
    
    // Dialogflow session ID (use phone number for conversation continuity)
    this.dialogflowSessionId = null;
  }

  setSessionInfo(webSocketData, callInfo = null) {
    this.sessionId = webSocketData.callSid;
    this.callSid = webSocketData.callSid;
    this.streamSid = webSocketData.streamSid;
    this.accountSid = webSocketData.accountSid;
    this.sessionStartTime = new Date();
    
    if (callInfo) {
      this.fromNumber = callInfo.from;
      this.toNumber = callInfo.to;
      this.fromCountry = callInfo.fromCountry;
      this.toCountry = callInfo.toCountry;
      this.fromLocation = `${callInfo.fromCity}, ${callInfo.fromState}`.replace(', ', '');
      
      // Create Dialogflow session ID using phone number for conversation continuity
      this.dialogflowSessionId = dialogflowService.generateSessionIdFromPhone(this.fromNumber);
    } else {
      this.fromNumber = 'unknown';
      this.toNumber = 'unknown';
      this.fromCountry = 'unknown';
      this.toCountry = 'unknown';
      this.fromLocation = 'unknown';
      this.dialogflowSessionId = dialogflowService.generateSessionId();
    }
    
    console.log('\n' + '🆔'.repeat(30));
    console.log('📋 SESSION STARTED:');
    console.log('🆔'.repeat(30));
    console.log(`🔑 Session ID: ${this.sessionId}`);
    console.log(`📞 Call SID: ${this.callSid}`);
    console.log(`🌊 Stream SID: ${this.streamSid}`);
    console.log(`📱 From: ${this.fromNumber} (${this.fromCountry})`);
    console.log(`📞 To: ${this.toNumber} (${this.toCountry})`);
    console.log(`📍 Location: ${this.fromLocation}`);
    console.log(`🤖 Dialogflow Session: ${this.dialogflowSessionId}`);
    console.log(`⏰ Started: ${this.sessionStartTime.toISOString()}`);
    console.log('🆔'.repeat(30) + '\n');
  }

  addAudioChunk(base64Audio) {
    this.chunkCount++;
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    this.audioChunks.push(audioBuffer);
    
    if (!this.isRecording) {
      this.isRecording = true;
      console.log('🎤 Started recording user query...');
      
      this.processingInterval = setInterval(() => {
        this.processAccumulatedAudio();
      }, this.processingIntervalTime);
    }

    if (this.chunkCount % 100 === 0) {
      console.log(`📦 Processed ${this.chunkCount} chunks so far...`);
    }
  }

  async processAccumulatedAudio() {
    const now = Date.now();
    
    console.log('🔍 DEBUG - processAccumulatedAudio called');
    console.log(`🔍 DEBUG - Time since last process: ${now - this.lastProcessTime}ms`);
    console.log(`🔍 DEBUG - Audio chunks available: ${this.audioChunks.length}`);
    
    if (now - this.lastProcessTime < 3000) {
      console.log('⏭️  Skipping - processed recently');
      return;
    }

    if (this.audioChunks.length < this.minChunksBeforeProcessing) {
      console.log(`⏱️  Not enough audio yet (${this.audioChunks.length} chunks, need ${this.minChunksBeforeProcessing})`);
      return;
    }

    console.log('\n' + '🎤'.repeat(20));
    console.log(`🔄 Processing audio for session: ${this.sessionId}`);
    console.log(`📊 Audio chunks: ${this.audioChunks.length}`);
    console.log(`⏰ Session duration: ${Math.round((now - this.sessionStartTime.getTime()) / 1000)}s`);
    
    const completeAudio = Buffer.concat(this.audioChunks);
    console.log(`📊 Audio size: ${completeAudio.length} bytes`);

    this.lastProcessTime = now;
    
    console.log('🔍 DEBUG - About to call transcribeAudioMulaw...');
    await this.transcribeAudioMulaw(completeAudio);
    console.log('🔍 DEBUG - transcribeAudioMulaw completed');

    this.audioChunks = [];
    this.chunkCount = 0;
    console.log('🔄 Ready for next audio segment...\n');
  }

  async transcribeAudioMulaw(mulawBuffer) {
    try {
      console.log(`🔍 Transcribing audio for caller: ${this.fromNumber}`);
      console.log(`🔊 DEBUG - Buffer length: ${mulawBuffer.length} bytes`);
      
      if (mulawBuffer.length === 0) {
        console.log('❌ Empty audio buffer');
        return;
      }
      
      const base64Audio = mulawBuffer.toString('base64');
      console.log(`🔊 DEBUG - Base64 audio length: ${base64Audio.length}`);
      
      const request = {
        audio: { content: base64Audio },
        config: {
          encoding: 'MULAW',
          sampleRateHertz: 8000,
          languageCode: 'en-US',
          model: 'phone_call',
          useEnhanced: true,
          enableAutomaticPunctuation: true,
          maxAlternatives: 1,
        },
      };

      console.log('🔍 DEBUG - Sending request to Google Speech API...');
      const [response] = await speechClient.recognize(request);
      
      console.log('🔍 DEBUG - Google Speech API response received');
      console.log('🔍 DEBUG - Response results length:', response.results?.length || 0);
      
      if (response.results && response.results.length > 0) {
        console.log('🔍 DEBUG - Processing speech results...');
        
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join(' ')
          .trim();
        
        const confidence = response.results[0].alternatives[0].confidence || 0;
        
        console.log(`🔍 DEBUG - Raw transcription: "${transcription}"`);
        console.log(`🔍 DEBUG - Confidence: ${(confidence * 100).toFixed(1)}%`);
        
        // LOWER THE CONFIDENCE THRESHOLD FOR DEBUGGING
        if (transcription === '' || confidence < 0.1) { // Changed from 0.3 to 0.1
          console.log(`⏭️  Skipping low quality transcription (confidence: ${(confidence * 100).toFixed(1)}%)`);
          console.log(`⏭️  DEBUG - Transcription was: "${transcription}"`);
          return;
        }
        
        // TEMPORARY: Send everything to DialogFlow for debugging
        if (transcription === '') {
          console.log(`⏭️  Empty transcription, skipping DialogFlow call`);
          return;
        }
        
        const timestamp = new Date().toISOString();
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 TRANSCRIPTION COMPLETED:');
        console.log('='.repeat(60));
        console.log(`🆔 Session: ${this.sessionId}`);
        console.log(`📱 From: ${this.fromNumber} (${this.fromLocation})`);
        console.log(`⏰ Time: ${timestamp}`);
        console.log(`📝 User Said: "${transcription}"`);
        console.log(`📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log('='.repeat(60));
        
        console.log('🚀 DEBUG - About to call sendToDialogflowAndLogResponse...');
        
        // 🚀 SEND TO DIALOGFLOW CX AND GET RESPONSE
        await this.sendToDialogflowAndLogResponse(transcription, confidence);
        
        console.log('🚀 DEBUG - sendToDialogflowAndLogResponse completed');
        
      } else {
        console.log(`❌ No transcription results for session: ${this.sessionId}`);
        console.log('🔍 DEBUG - Full Google Speech response:');
        console.log(JSON.stringify(response, null, 2));
      }
    } catch (error) {
      console.error(`❌ Transcription error for session ${this.sessionId}:`, error.message);
      console.error('🔍 DEBUG - Full error:', error);
    }
  }

  async sendToDialogflowAndLogResponse(userMessage, confidence) {
    try {
      console.log('\n' + '🚀'.repeat(25));
      console.log('🤖 SENDING TO DIALOGFLOW CX...');
      console.log('🚀'.repeat(25));
      console.log(`📞 Caller: ${this.fromNumber}`);
      console.log(`🆔 DF Session: ${this.dialogflowSessionId}`);
      console.log(`💬 Message: "${userMessage}"`);
      
      // Send to DialogFlow CX
      const dfResponse = await dialogflowService.sendMessage(
        userMessage, 
        this.dialogflowSessionId
      );
      
      console.log('\n' + '🎉'.repeat(25));
      console.log('🤖 DIALOGFLOW CX RESPONSE:');
      console.log('🎉'.repeat(25));
      
      if (dfResponse.success) {
        console.log(`✅ Success: true`);
        console.log(`🆔 Response ID: ${dfResponse.sessionId}`);
        
        // Log Intent Information
        if (dfResponse.intent) {
          console.log(`🎯 Intent Detected: ${dfResponse.intent.displayName}`);
          console.log(`📊 Intent Confidence: ${(dfResponse.intent.confidence * 100).toFixed(1)}%`);
        } else {
          console.log(`🎯 Intent: No intent detected`);
        }
        
        // Log Current Page
        if (dfResponse.currentPage) {
          console.log(`📄 Current Page: ${dfResponse.currentPage.displayName}`);
        }
        
        // Log Parameters
        if (dfResponse.parameters && Object.keys(dfResponse.parameters).length > 0) {
          console.log(`📋 Extracted Parameters:`);
          Object.entries(dfResponse.parameters).forEach(([key, value]) => {
            console.log(`   - ${key}: ${JSON.stringify(value)}`);
          });
        } else {
          console.log(`📋 Parameters: None extracted`);
        }
        
        // 🎤 LOG THE MAIN RESPONSE MESSAGES
        console.log(`🗣️  BOT RESPONSES:`);
        if (dfResponse.messages && dfResponse.messages.length > 0) {
          dfResponse.messages.forEach((message, index) => {
            console.log(`   ${index + 1}. "${message}"`);
          });
        } else {
          console.log(`   (No response messages)`);
        }
        
        console.log(`🌍 Language: ${dfResponse.languageCode}`);
        
      } else {
        console.log(`❌ Success: false`);
        console.log(`💥 Error: ${dfResponse.error}`);
        console.log(`🗣️  Fallback Response: ${dfResponse.messages.join(' ')}`);
      }
      
      console.log('🎉'.repeat(25) + '\n');
      
      // Save the complete conversation exchange
      this.saveConversationLog({
        sessionId: this.sessionId,
        dialogflowSessionId: this.dialogflowSessionId,
        fromNumber: this.fromNumber,
        timestamp: new Date().toISOString(),
        userMessage: userMessage,
        userConfidence: confidence,
        dialogflowResponse: dfResponse,
        success: dfResponse.success
      });
      
    } catch (error) {
      console.error('\n❌ ERROR COMMUNICATING WITH DIALOGFLOW CX:');
      console.error(`💥 Error: ${error.message}`);
      console.error(`📞 Caller: ${this.fromNumber}`);
      console.error(`💬 Message that failed: "${userMessage}"`);
      console.error('Full error:', error);
    }
  }

  saveConversationLog(data) {
    try {
      const logFile = `conversations_${new Date().toISOString().split('T')[0]}.jsonl`;
      fs.appendFileSync(logFile, JSON.stringify(data) + '\n');
      console.log(`💾 Conversation saved to: ${logFile}`);
    } catch (error) {
      console.error('❌ Failed to save conversation log:', error.message);
    }
  }

  async forceProcessAudio() {
    console.log('🔄 Forcing final audio processing...');
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.audioChunks.length > 0) {
      await this.processAccumulatedAudio();
    }
  }

  reset() {
    console.log(`🔄 RESET called for session: ${this.sessionId || 'unknown'}`);
    
    if (this.sessionStartTime) {
      const duration = Math.round((Date.now() - this.sessionStartTime.getTime()) / 1000);
      console.log(`📊 Final Session Summary:`);
      console.log(`   📱 Caller: ${this.fromNumber}`);
      console.log(`   🤖 DF Session: ${this.dialogflowSessionId}`);
      console.log(`   ⏰ Duration: ${duration} seconds`);
      console.log(`   📊 Total Chunks: ${this.chunkCount}`);
    }
    
    if (this.callSid) {
      activeCalls.delete(this.callSid);
    }
    
    // Reset all properties
    this.audioChunks = [];
    this.isRecording = false;
    this.lastProcessTime = 0;
    this.chunkCount = 0;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    this.sessionId = null;
    this.callSid = null;
    this.streamSid = null;
    this.accountSid = null;
    this.fromNumber = null;
    this.toNumber = null;
    this.fromCountry = null;
    this.toCountry = null;
    this.fromLocation = null;
    this.sessionStartTime = null;
    this.dialogflowSessionId = null;
    
    console.log('🔄 Ready for next call...\n');
  }
}

// Create audio buffer instance
const audioBuffer = new AudioBuffer();

// TwiML route
app.post("/twiml", (req, res) => {
  console.log("📞 TwiML request received");
  
  // const callInfo = {
  //   callSid: req.body.CallSid,
  //   from: req.body.From || req.body.Caller,
  //   to: req.body.To || req.body.Called,
  //   fromCountry: req.body.FromCountry,
  //   toCountry: req.body.ToCountry,
  //   fromState: req.body.FromState,
  //   toState: req.body.ToState,
  //   fromCity: req.body.FromCity,
  //   toCity: req.body.ToCity,
  //   accountSid: req.body.AccountSid,
  //   callStatus: req.body.CallStatus,
  //   direction: req.body.Direction
  // };
  
  // activeCalls.set(callInfo.callSid, callInfo);
  
  // console.log('📋 INCOMING CALL:');
  // console.log(`🔑 Call SID: ${callInfo.callSid}`);
  // console.log(`📱 From: ${callInfo.from} (${callInfo.fromCountry})`);
  // console.log(`📞 To: ${callInfo.to}`);
  // console.log(`📍 Location: ${callInfo.fromCity}, ${callInfo.fromState}`);
  
  const filePath = path.join(__dirname, "templates", "streams.xml");
  res.type("text/xml");
  res.sendFile(filePath);
});

// WebSocket connection handler
mediaws.on("connect", function (connection) {
  console.log("📞 Twilio WebSocket connected");

  connection.on("message", function (message) {
    if (message.type === "utf8") {
      try {
        const data = JSON.parse(message.utf8Data);
        
        if (data.event === "connected") {
          console.log("✅ Twilio stream connected");
        } else if (data.event === "start") {
          console.log("🎤 Audio stream started");
          
          const sessionInfo = {
            callSid: data.start.callSid,
            streamSid: data.start.streamSid,
            accountSid: data.start.accountSid
          };
          
          const callInfo = activeCalls.get(sessionInfo.callSid);
          
          audioBuffer.reset();
          audioBuffer.setSessionInfo(sessionInfo, callInfo);
          
        } else if (data.event === "media" && data.media && data.media.payload) {
          audioBuffer.addAudioChunk(data.media.payload);
        } else if (data.event === "stop") {
          console.log("🛑 Audio stream stopped - forcing final processing");
          audioBuffer.forceProcessAudio();
        }
      } catch (error) {
        console.error("❌ Error parsing WebSocket message:", error);
      }
    }
  });

  connection.on("close", function () {
    console.log("📞 Twilio WebSocket disconnected");
    audioBuffer.forceProcessAudio().then(() => {
      audioBuffer.reset();
    });
  });
});

app.get("/ping", (req, res) => {
  const timestamp = new Date().toISOString();
  const uptime = process.uptime();
  
  console.log(`🏓 Ping received at ${timestamp}`);
  
  res.json({
    status: "ok",
    message: "Voice + DialogFlow CX Server is running",
    timestamp: timestamp,
    uptime: `${Math.floor(uptime)} seconds`,
    services: {
      speech: "Google Cloud Speech-to-Text",
      dialogflow: "DialogFlow CX",
      websocket: "Twilio WebSocket"
    },
    endpoints: {
      ping: "/ping",
      twiml: "/twiml",
      websocket: `ws://localhost:${HTTP_SERVER_PORT}`
    }
  });
});



// Start server
server.listen(HTTP_SERVER_PORT, function () {
  console.log('\n' + '🚀'.repeat(20));
  console.log("🎉 VOICE + DIALOGFLOW CX SERVER STARTED");
  console.log('🚀'.repeat(20));
  console.log(`🌐 Server: http://localhost:${HTTP_SERVER_PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${HTTP_SERVER_PORT}`);
  console.log(`📄 TwiML: http://localhost:${HTTP_SERVER_PORT}/twiml`);
  console.log(`🤖 DialogFlow CX: ${dialogflowService.projectId}`);
  console.log("🎤 Ready to process calls and chat with AI!");
  console.log('🚀'.repeat(20) + '\n');
});