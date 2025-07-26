#!/usr/bin/env node

const fs = require('fs');

class TwilioAudioProcessor {
  constructor() {
    this.sampleRate = 8000;
    this.channels = 1;
    this.bitsPerSample = 16;
  }

  extractAudioFromTwilioArray(jsonArray) {
    console.log('🔍 PROCESSING TWILIO WEBSOCKET DATA:');
    
    if (!Array.isArray(jsonArray)) {
      throw new Error('Data is not an array');
    }

    console.log(`📊 Total messages: ${jsonArray.length}`);
    
    // Find all media messages
    const mediaMessages = jsonArray.filter(msg => 
      msg.event === 'media' && msg.media && msg.media.payload
    );
    
    console.log(`🎵 Media messages found: ${mediaMessages.length}`);
    
    if (mediaMessages.length === 0) {
      throw new Error('No media messages found');
    }

    // Sort by sequence number to ensure correct order
    mediaMessages.sort((a, b) => parseInt(a.sequenceNumber) - parseInt(b.sequenceNumber));
    
    // Decode each message individually and collect buffers
    console.log('🔄 Decoding individual messages...');
    const audioBuffers = [];
    let totalBytes = 0;
    let failedCount = 0;
    
    mediaMessages.forEach((msg, index) => {
      try {
        const decoded = Buffer.from(msg.media.payload, 'base64');
        audioBuffers.push(decoded);
        totalBytes += decoded.length;
        
        if (index < 3 || index >= mediaMessages.length - 3) {
          console.log(`  Message ${index + 1}: seq ${msg.sequenceNumber}, ${decoded.length} bytes`);
        } else if (index === 3) {
          console.log(`  ... (${mediaMessages.length - 6} more messages) ...`);
        }
      } catch (error) {
        console.error(`❌ Failed to decode message ${index + 1}: ${error.message}`);
        failedCount++;
      }
    });
    
    console.log(`✅ Successfully decoded: ${mediaMessages.length - failedCount}/${mediaMessages.length} messages`);
    console.log(`📊 Total audio data: ${totalBytes} bytes`);
    console.log(`📊 Expected duration: ~${(totalBytes / this.sampleRate).toFixed(2)} seconds`);
    
    // Combine all buffers
    const combinedBuffer = Buffer.concat(audioBuffers);
    console.log(`🔗 Combined buffer size: ${combinedBuffer.length} bytes`);
    
    return combinedBuffer;
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

  applyGain(pcmBuffer, gain) {
    for (let i = 0; i < pcmBuffer.length; i += 2) {
      let sample = pcmBuffer.readInt16LE(i);
      sample = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
      pcmBuffer.writeInt16LE(sample, i);
    }
  }

  convertToWav(jsonArray, outputPath, options = {}) {
    console.log('🎵 TWILIO TO WAV CONVERTER');
    console.log('=' .repeat(50));
    
    // Extract audio data using corrected method
    const mulawBuffer = this.extractAudioFromTwilioArray(jsonArray);
    
    console.log('\n🔄 CONVERTING TO WAV:');
    
    // Convert μ-law to PCM
    const pcmBuffer = this.mulawToPcm(mulawBuffer);
    console.log(`✅ Converted to PCM: ${pcmBuffer.length} bytes`);
    
    // Apply gain if specified
    if (options.gain && options.gain !== 1.0) {
      this.applyGain(pcmBuffer, options.gain);
      console.log(`🔊 Applied gain: ${options.gain}x`);
    }
    
    // Create WAV file
    const wavHeader = this.createWavHeader(pcmBuffer.length);
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
    

    if(outputPath) {

      fs.writeFileSync(outputPath, wavBuffer);
    
      const duration = (mulawBuffer.length / this.sampleRate).toFixed(2);
      console.log(`\n✅ CONVERSION COMPLETE:`);
      console.log(`📁 File: ${outputPath}`);
      console.log(`📊 Duration: ${duration} seconds`);
      console.log(`📊 File size: ${(wavBuffer.length / 1024).toFixed(2)} KB`);
      console.log(`🎧 Format: ${this.sampleRate}Hz, ${this.channels}ch, ${this.bitsPerSample}-bit PCM`);
      
      return false;

    } else {
      // return the wav buffer
      console.log("returning wav buffer");
      return wavBuffer;
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log(`
🎵 Twilio WebSocket to WAV Converter (FIXED)

Usage:
  node fixed-converter.js <input.json> [optional - if not provided, then the wav buffer will be returned]<output.wav> [options]

Options:
  --gain=<number>        Apply gain multiplier (e.g., --gain=2.0)

Examples:
  node fixed-converter.js audio_2.json call.wav
  node fixed-converter.js audio_2.json call.wav --gain=1.5
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
    
    console.log("outputFile ->>> ", outputFile);
    
    const processor = new TwilioAudioProcessor();
    
    // can be wavBinary or false
    const wavOutput = processor.convertToWav(jsonData, outputFile, options);

    if(wavOutput) {
      return wavOutput;
    }

    console.log('\n🎉 Success! You should now have ~21 seconds of audio.');
    console.log('🎧 Try playing the WAV file with your media player!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { TwilioAudioProcessor };