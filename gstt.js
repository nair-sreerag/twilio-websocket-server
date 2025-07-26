"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { server: WebSocketServer } = require("websocket");
const speech = require('@google-cloud/speech');

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

class AudioBuffer {
  constructor() {
    this.audioChunks = [];
    this.processingInterval = null;
    this.processingIntervalTime = 4000; // Process every 4 seconds
    this.isRecording = false;
    this.lastProcessTime = 0;
    this.chunkCount = 0;
    this.minChunksBeforeProcessing = 100; // ~2 seconds of audio
  }

  addAudioChunk(base64Audio) {
    this.chunkCount++;
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    this.audioChunks.push(audioBuffer);
    
    if (!this.isRecording) {
      this.isRecording = true;
      console.log('🎤 Started recording user query...');
      
      // Start interval-based processing
      this.processingInterval = setInterval(() => {
        this.processAccumulatedAudio();
      }, this.processingIntervalTime);
    }

    // Remove excessive logging for production
    if (this.chunkCount % 100 === 0) {
      console.log(`📦 Processed ${this.chunkCount} chunks so far...`);
    }
  }

  async processAccumulatedAudio() {
    const now = Date.now();
    
    // Don't process if we just processed recently
    if (now - this.lastProcessTime < 3000) {
      console.log('⏭️  Skipping - processed recently');
      return;
    }

    // Don't process if we don't have enough audio
    if (this.audioChunks.length < this.minChunksBeforeProcessing) {
      console.log(`⏱️  Not enough audio yet (${this.audioChunks.length} chunks)`);
      return;
    }

    console.log('🔄 Processing accumulated audio...');
    console.log(`📊 Total audio chunks: ${this.audioChunks.length}`);
    
    // Combine all audio chunks
    const completeAudio = Buffer.concat(this.audioChunks);
    console.log(`📊 Total audio size: ${completeAudio.length} bytes`);
    console.log(`📊 Estimated duration: ${(completeAudio.length / 8000).toFixed(2)} seconds`);

    this.lastProcessTime = now;

    // Process the audio
    await this.transcribeAudioMulaw(completeAudio);

    // Reset chunks but keep recording (for next segment)
    this.audioChunks = [];
    this.chunkCount = 0;
    console.log('🔄 Ready for next audio segment...\n');
  }

  async forceProcessAudio() {
    console.log('🔄 Forcing final audio processing...');
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Process any remaining audio
    if (this.audioChunks.length > 0) {
      await this.processAccumulatedAudio();
    }
  }

  createWavBuffer(mulawData) {
    // Convert μ-law to 16-bit PCM
    const pcmData = new Int16Array(mulawData.length);
    for (let i = 0; i < mulawData.length; i++) {
      pcmData[i] = this.mulawToPcm(mulawData[i]);
    }

    // Create WAV header
    const pcmBuffer = Buffer.from(pcmData.buffer);
    const wavHeader = this.createWavHeader(pcmBuffer.length);
    
    return Buffer.concat([wavHeader, pcmBuffer]);
  }

  mulawToPcm(mulawByte) {
    const BIAS = 0x84;
    const CLIP = 32635;
    
    mulawByte = ~mulawByte;
    const sign = (mulawByte & 0x80);
    const exponent = (mulawByte >> 4) & 0x07;
    const mantissa = mulawByte & 0x0F;
    
    let sample = mantissa << (exponent + 3);
    sample += BIAS;
    if (exponent !== 0) sample += (1 << (exponent + 2));
    
    return sign !== 0 ? -sample : sample;
  }

  createWavHeader(dataLength) {
    const header = Buffer.alloc(44);
    const sampleRate = 8000;
    const channels = 1;
    const bitsPerSample = 16;
    
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
    header.writeUInt16LE(channels * bitsPerSample / 8, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    
    return header;
  }

  async transcribeAudioMulaw(mulawBuffer) {
    try {
      console.log('🔍 Transcribing with MULAW encoding...');
      
      // Add debugging
      console.log(`🔊 MULAW buffer size: ${mulawBuffer.length} bytes`);
      console.log(`🔊 First 20 bytes: ${Array.from(mulawBuffer.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      
      if (mulawBuffer.length === 0) {
        console.log('❌ Empty audio buffer');
        return;
      }
      
      const base64Audio = mulawBuffer.toString('base64');
      console.log(`🔊 Base64 length: ${base64Audio.length}`);
      
      const request = {
        audio: { 
          content: base64Audio 
        },
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

      console.log('🔍 Sending request to Google Speech API...');
      const [response] = await speechClient.recognize(request);
      
      console.log('🔍 Google Speech API response:', JSON.stringify(response, null, 2));
      
      if (response.results && response.results.length > 0) {
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join(' ');
        
        const confidence = response.results[0].alternatives[0].confidence || 0;
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 TRANSCRIPTION RESULT:');
        console.log('='.repeat(60));
        console.log(`📝 Text: "${transcription}"`);
        console.log(`🌍 Language: English`);
        console.log(`📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log('='.repeat(60) + '\n');
      } else {
        console.log('❌ No transcription results found');
        // Fallback to LINEAR16 conversion
        console.log('🔄 Trying with LINEAR16 conversion...');
        const wavBuffer = this.createWavBuffer(mulawBuffer);
        await this.transcribeAudio(wavBuffer);
      }
    } catch (error) {
      console.error('❌ Speech recognition error:', error.message);
      console.error('Full error:', error);
      
      // Fallback to LINEAR16 conversion
      console.log('🔄 Trying with LINEAR16 conversion as fallback...');
      try {
        const wavBuffer = this.createWavBuffer(mulawBuffer);
        await this.transcribeAudio(wavBuffer);
      } catch (fallbackError) {
        console.error('❌ Fallback also failed:', fallbackError.message);
      }
    }
  }

  async transcribeAudio(audioBuffer) {
    try {
      console.log('🔍 Transcribing complete audio...');
      
      // Add debugging for the audio buffer
      console.log(`🔊 Audio buffer size: ${audioBuffer.length} bytes`);
      console.log(`🔊 First 20 bytes: ${Array.from(audioBuffer.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      
      const request = {
        audio: { content: audioBuffer.toString('base64') },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 8000,
          languageCode: 'en-US', // Fix the comment - this is English, not Hindi
          model: 'phone_call',
          useEnhanced: true,
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: false,
          maxAlternatives: 1,
        },
      };

      const [response] = await speechClient.recognize(request);
      
      // Add debugging for the response
      console.log('🔍 Google Speech API response:', JSON.stringify(response, null, 2));
      
      if (response.results && response.results.length > 0) {
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join(' ');
        
        const confidence = response.results[0].alternatives[0].confidence || 0;
        const detectedLanguage = response.results[0].languageCode || 'Unknown';
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 TRANSCRIPTION RESULT:');
        console.log('='.repeat(60));
        console.log(`📝 Text: "${transcription}"`);
        console.log(`🌍 Language: ${detectedLanguage}`);
        console.log(`📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log('='.repeat(60) + '\n');
        
        // If confidence is low, try English
        if (confidence < 0.7 && detectedLanguage.startsWith('hi')) {
          console.log('🔄 Low confidence for Hindi, trying English...');
          await this.retryWithEnglish(audioBuffer);
        }
      } else {
        console.log('❌ No transcription results found');
        console.log('🔄 Trying with MULAW encoding directly...');
        await this.retryWithMulaw(audioBuffer);
      }
    } catch (error) {
      console.error('❌ Speech recognition error:', error.message);
      console.log('🔄 Trying with MULAW encoding directly...');
      await this.retryWithMulaw(audioBuffer);
    }
  }

  async retryWithEnglish(audioBuffer) {
    try {
      const request = {
        audio: { content: audioBuffer.toString('base64') },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 8000,
          languageCode: 'en-US',
          model: 'phone_call',
          useEnhanced: true,
          enableAutomaticPunctuation: true,
          maxAlternatives: 1,
        },
      };

      const [response] = await speechClient.recognize(request);
      
      if (response.results && response.results.length > 0) {
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join(' ');
        
        const confidence = response.results[0].alternatives[0].confidence || 0;
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 ENGLISH FALLBACK RESULT:');
        console.log('='.repeat(60));
        console.log(`📝 Text: "${transcription}"`);
        console.log(`🌍 Language: English`);
        console.log(`📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log('='.repeat(60) + '\n');
      } else {
        console.log('❌ No transcription results in English either');
      }
    } catch (error) {
      console.error('❌ English fallback failed:', error.message);
    }
  }

  // Add this new method to try MULAW directly (skip conversion)
  async retryWithMulaw(audioBuffer) {
    try {
      console.log('🔄 Trying with direct MULAW encoding...');
      
      // Get the original μ-law data (before WAV conversion)
      const mulawData = Buffer.concat(this.audioChunks);
      
      // Add debugging
      console.log(`🔊 MULAW data size: ${mulawData.length} bytes`);
      console.log(`🔊 Audio chunks count: ${this.audioChunks.length}`);
      console.log(`🔊 First few bytes: ${Array.from(mulawData.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      
      if (mulawData.length === 0) {
        console.log('❌ No MULAW data available');
        return;
      }
      
      const request = {
        audio: { 
          content: mulawData.toString('base64') 
        },
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

      // Add debugging for the request
      console.log(`🔊 Base64 audio length: ${mulawData.toString('base64').length}`);
      console.log(`🔊 Base64 preview: ${mulawData.toString('base64').substring(0, 50)}...`);

      const [response] = await speechClient.recognize(request);
      
      if (response.results && response.results.length > 0) {
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join(' ');
        
        const confidence = response.results[0].alternatives[0].confidence || 0;
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 MULAW TRANSCRIPTION RESULT:');
        console.log('='.repeat(60));
        console.log(`📝 Text: "${transcription}"`);
        console.log(`🌍 Language: English (MULAW)`);
        console.log(`📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log('='.repeat(60) + '\n');
      } else {
        console.log('❌ No transcription results with MULAW either');
      }
    } catch (error) {
      console.error('❌ MULAW transcription failed:', error.message);
      console.error('Full error:', error);
    }
  }

  reset() {
    console.log(`🔄 RESET called - had ${this.chunkCount} chunks`);
    this.audioChunks = [];
    this.isRecording = false;
    this.lastProcessTime = 0;
    this.chunkCount = 0;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    console.log('🔄 Ready for next call...\n');
  }
}

// Create audio buffer instance
const audioBuffer = new AudioBuffer();

// WebSocket connection handler
mediaws.on("connect", function (connection) {
  console.log("📞 Twilio WebSocket connected");

  connection.on("message", function (message) {
    if (message.type === "utf8") {
      try {
        const data = JSON.parse(message.utf8Data);
        
        // LOG ALL EVENTS
        console.log(`📨 WebSocket event: ${data.event} at ${new Date().toISOString()}`);
        
        if (data.event === "connected") {
          console.log("✅ Twilio stream connected");
        } else if (data.event === "start") {
          console.log("🎤 Audio stream started");
          console.log("🔊 Waiting for user to speak...");
          audioBuffer.reset();
        } else if (data.event === "media" && data.media && data.media.payload) {
          // Add audio chunk to buffer
          audioBuffer.addAudioChunk(data.media.payload);
        } else if (data.event === "stop") {
          console.log("🛑 Audio stream stopped - forcing processing");
          audioBuffer.forceProcessAudio();
        } else {
          console.log(`❓ Unknown event: ${data.event}`);
        }
      } catch (error) {
        console.error("❌ Error parsing WebSocket message:", error);
      }
    }
  });

  connection.on("close", function () {
    console.log("📞 Twilio WebSocket disconnected");
    audioBuffer.reset();
  });
});

// Routes
app.post("/twiml", (req, res) => {
  console.log("twiml request received");
  const filePath = path.join(__dirname, "templates", "streams.xml");
  res.type("text/xml");
  res.sendFile(filePath);
});

// app.get("/", (req, res) => {
//   res.send(`
//     <h1>🎤 Complete Query Transcription Server</h1>
//     <p>✅ Server is running</p>
//     <p>📞 WebSocket ready for Twilio connections</p>
//     <p>🔊 Waits for complete user query before processing</p>
//     <p>🌍 Supports Hindi and English auto-detection</p>
//   `);
// });

// Start server
server.listen(HTTP_SERVER_PORT, function () {
  console.log("🚀 Complete Query Transcription Server started");
  console.log(`🌐 Server: http://localhost:${HTTP_SERVER_PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${HTTP_SERVER_PORT}`);
  console.log(`📄 TwiML: http://localhost:${HTTP_SERVER_PORT}/twiml`);
  console.log("🎤 Ready to process complete user queries!");
});