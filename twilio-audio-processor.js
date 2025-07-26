#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class TwilioAudioProcessor {
  constructor() {
    this.sampleRate = 8000;
    this.channels = 1;
    this.bitsPerSample = 16;
  }

  // Extract ALL media payloads from Twilio WebSocket message array
  extractAllMediaPayloads(jsonData) {
    console.log('🔍 ANALYZING TWILIO WEBSOCKET DATA:');
    
    if (!Array.isArray(jsonData)) {
      console.log('❌ Data is not an array');
      return null;
    }

    console.log(`📊 Total messages in array: ${jsonData.length}`);
    
    const mediaMessages = [];
    const eventCounts = {};
    
    jsonData.forEach((message, index) => {
      const eventType = message.event || 'unknown';
      eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
      
      if (eventType === 'media' && message.media && message.media.payload) {
        mediaMessages.push({
          index: index,
          sequenceNumber: message.sequenceNumber,
          chunk: message.media.chunk,
          timestamp: message.media.timestamp,
          track: message.media.track,
          payload: message.media.payload,
          payloadLength: message.media.payload.length
        });
      }
    });

    // Show statistics
    console.log('\n📈 EVENT STATISTICS:');
    Object.entries(eventCounts).forEach(([event, count]) => {
      console.log(`  ${event}: ${count} messages`);
    });

    console.log(`\n🎵 MEDIA MESSAGES FOUND: ${mediaMessages.length}`);
    
    if (mediaMessages.length === 0) {
      console.log('❌ No media events with payloads found!');
      return null;
    }

    // Show first few and last few media messages
    console.log('\n📋 MEDIA MESSAGE DETAILS:');
    const showCount = Math.min(3, mediaMessages.length);
    
    mediaMessages.slice(0, showCount).forEach(msg => {
      console.log(`  Seq ${msg.sequenceNumber}: chunk ${msg.chunk}, timestamp ${msg.timestamp}, ${msg.payloadLength} chars`);
    });
    
    if (mediaMessages.length > showCount * 2) {
      console.log(`  ... (${mediaMessages.length - showCount * 2} more messages) ...`);
    }
    
    if (mediaMessages.length > showCount) {
      mediaMessages.slice(-showCount).forEach(msg => {
        console.log(`  Seq ${msg.sequenceNumber}: chunk ${msg.chunk}, timestamp ${msg.timestamp}, ${msg.payloadLength} chars`);
      });
    }

    // Concatenate all payloads in order
    const combinedPayload = mediaMessages
      .sort((a, b) => parseInt(a.sequenceNumber) - parseInt(b.sequenceNumber))
      .map(msg => msg.payload)
      .join('');

    console.log(`\n✅ COMBINED PAYLOAD: ${combinedPayload.length} characters`);
    console.log(`📊 Expected duration: ~${(Buffer.from(combinedPayload, 'base64').length / 8000).toFixed(2)} seconds`);

    return combinedPayload;
  }

  mulawDecode(mulawByte) {
    const BIAS = 0x84;
    const CLIP = 32635;
    
    mulawByte = (~mulawByte) & 0xFF;
    const sign = (mulawByte & 0x80);
    const exponent = (mulawByte >> 4) & 0x07;
    const mantissa = mulawByte & 0x0F;
    
    let linearValue;
    if (exponent === 0) {
      linearValue = (mantissa << 4) + BIAS;
    } else {
      linearValue = ((mantissa | 0x10) << (exponent + 3)) + BIAS;
    }
    
    if (sign) linearValue = -linearValue;
    return Math.max(-CLIP, Math.min(CLIP, linearValue));
  }

  mulawToPcm(mulawBuffer) {
    const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);
    for (let i = 0; i < mulawBuffer.length; i++) {
      const pcmValue = this.mulawDecode(mulawBuffer[i]);
      pcmBuffer.writeInt16LE(pcmValue, i * 2);
    }
    return pcmBuffer;
  }

  createWavHeader(dataSize) {
    const buffer = Buffer.alloc(44);
    let offset = 0;
    
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4;
    buffer.writeUInt16LE(1, offset); offset += 2;
    buffer.writeUInt16LE(this.channels, offset); offset += 2;
    buffer.writeUInt32LE(this.sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(this.sampleRate * this.channels * (this.bitsPerSample / 8), offset); offset += 4;
    buffer.writeUInt16LE(this.channels * (this.bitsPerSample / 8), offset); offset += 2;
    buffer.writeUInt16LE(this.bitsPerSample, offset); offset += 2;
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;
    
    return buffer;
  }

  convertTwilioArrayToWav(jsonArray, outputPath, options = {}) {
    console.log('🎵 TWILIO WEBSOCKET AUDIO PROCESSOR');
    console.log('=' .repeat(50));
    
    const combinedPayload = this.extractAllMediaPayloads(jsonArray);
    if (!combinedPayload) {
      throw new Error('No audio data found in the WebSocket messages');
    }

    console.log('\n🔄 CONVERSION PROCESS:');
    const mulawBuffer = Buffer.from(combinedPayload, 'base64');
    console.log(`📊 Total μ-law data: ${mulawBuffer.length} bytes`);
    
    const pcmBuffer = this.mulawToPcm(mulawBuffer);
    console.log(`✅ Converted to PCM: ${pcmBuffer.length} bytes`);
    
    if (options.gain && options.gain !== 1.0) {
      this.applyGain(pcmBuffer, options.gain);
      console.log(`🔊 Applied gain: ${options.gain}x`);
    }
    
    const wavHeader = this.createWavHeader(pcmBuffer.length);
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
    
    fs.writeFileSync(outputPath, wavBuffer);
    
    const duration = (mulawBuffer.length / this.sampleRate).toFixed(2);
    console.log(`\n✅ CONVERSION COMPLETE:`);
    console.log(`📁 File: ${outputPath}`);
    console.log(`📊 Duration: ${duration} seconds`);
    console.log(`📊 File size: ${(wavBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`🎧 Format: ${this.sampleRate}Hz, ${this.channels}ch, ${this.bitsPerSample}-bit PCM`);
    
    return true;
  }

  applyGain(pcmBuffer, gain) {
    for (let i = 0; i < pcmBuffer.length; i += 2) {
      let sample = pcmBuffer.readInt16LE(i);
      sample = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
      pcmBuffer.writeInt16LE(sample, i);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
🎵 Twilio WebSocket Audio Processor

Usage:
  node twilio-audio-processor.js <input.json> <output.wav> [options]

Options:
  --gain=<number>        Apply gain multiplier (e.g., --gain=2.0)

Examples:
  node twilio-audio-processor.js audio_2.json complete_call.wav
  node twilio-audio-processor.js audio_2.json call.wav --gain=1.5

Input format:
  JSON array of Twilio WebSocket messages with media events
    `);
    process.exit(1);
  }
  
  const inputFile = args[0];
  const outputFile = args[1];
  
  const options = {};
  args.slice(2).forEach(arg => {
    if (arg.startsWith('--gain=')) {
      options.gain = parseFloat(arg.split('=')[1]);
    }
  });
  
  try {
    console.log(`📖 Reading: ${inputFile}`);
    const jsonData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    
    const processor = new TwilioAudioProcessor();
    processor.convertTwilioArrayToWav(jsonData, outputFile, options);
    
    console.log('\n🎉 Success! Try playing the WAV file now.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { TwilioAudioProcessor };