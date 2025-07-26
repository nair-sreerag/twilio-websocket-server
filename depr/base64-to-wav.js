#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class Base64ToWavConverter {
  constructor() {
    this.sampleRate = 8000;  // Standard telephony sample rate
    this.channels = 1;       // Mono
    this.bitsPerSample = 16; // 16-bit PCM output
  }

  // Convert base64 string to WAV file
  convertBase64ToWav(base64Data, outputPath) {
    console.log('🔄 Starting conversion process...');
    
    // Step 1: Decode base64 to binary buffer (μ-law data)
    console.log('📥 Decoding base64 data...');
    const mulawBuffer = Buffer.from(base64Data, 'base64');
    console.log(`📊 μ-law data size: ${mulawBuffer.length} bytes`);
    
    // Step 2: Convert μ-law to linear PCM
    console.log('🔧 Converting μ-law to PCM...');
    const pcmBuffer = this.mulawToPcm(mulawBuffer);
    console.log(`📊 PCM data size: ${pcmBuffer.length} bytes`);
    
    // Step 3: Create WAV file with header
    console.log('🎵 Creating WAV file...');
    const wavBuffer = this.createWavBuffer(pcmBuffer);
    
    // Step 4: Write to file
    fs.writeFileSync(outputPath, wavBuffer);
    
    const durationSeconds = (mulawBuffer.length / this.sampleRate).toFixed(2);
    console.log(`✅ WAV file created: ${outputPath}`);
    console.log(`📊 Duration: ${durationSeconds} seconds`);
    console.log(`📁 File size: ${(wavBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`🎧 Format: ${this.sampleRate}Hz, ${this.channels} channel(s), ${this.bitsPerSample}-bit`);
  }

  // Convert μ-law encoded bytes to linear PCM
  mulawToPcm(mulawBuffer) {
    // Each μ-law byte becomes a 16-bit PCM sample
    const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);
    
    for (let i = 0; i < mulawBuffer.length; i++) {
      const mulawByte = mulawBuffer[i];
      const pcmValue = this.mulawDecode(mulawByte);
      pcmBuffer.writeInt16LE(pcmValue, i * 2);
    }
    
    return pcmBuffer;
  }

  // μ-law decoder algorithm (ITU-T G.711)
  mulawDecode(mulawByte) {
    const BIAS = 0x84;
    const CLIP = 32635;
    
    // Step 1: Invert all bits (μ-law is stored with inverted bits)
    mulawByte = ~mulawByte;
    
    // Step 2: Extract sign bit (MSB)
    const sign = (mulawByte & 0x80);
    
    // Step 3: Extract exponent (3 bits)
    const exponent = (mulawByte >> 4) & 0x07;
    
    // Step 4: Extract mantissa (4 bits)
    const mantissa = mulawByte & 0x0F;
    
    // Step 5: Reconstruct linear sample value
    let sample = mantissa << (exponent + 3);
    sample += BIAS;
    
    // Step 6: Apply sign
    if (sign) {
      sample = -sample;
    }
    
    // Step 7: Clip to prevent overflow
    return Math.max(-CLIP, Math.min(CLIP, sample));
  }

  // Create WAV file buffer with proper header
  createWavBuffer(pcmData) {
    const bytesPerSample = this.bitsPerSample / 8;
    const blockAlign = this.channels * bytesPerSample;
    const byteRate = this.sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;
    
    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;
    
    // RIFF Chunk Descriptor
    buffer.write('RIFF', offset, 4, 'ascii'); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset, 4, 'ascii'); offset += 4;
    
    // Format Sub-chunk
    buffer.write('fmt ', offset, 4, 'ascii'); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4;        // Sub-chunk size
    buffer.writeUInt16LE(1, offset); offset += 2;         // Audio format (1 = PCM)
    buffer.writeUInt16LE(this.channels, offset); offset += 2;
    buffer.writeUInt32LE(this.sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(this.bitsPerSample, offset); offset += 2;
    
    // Data Sub-chunk
    buffer.write('data', offset, 4, 'ascii'); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;
    
    // Audio data
    pcmData.copy(buffer, offset);
    
    return buffer;
  }

  // Save intermediate μ-law file (optional, for debugging)
  saveMulawFile(base64Data, outputPath) {
    const mulawBuffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(outputPath, mulawBuffer);
    console.log(`💾 μ-law file saved: ${outputPath}`);
  }
}

// Helper functions for different input sources

// Convert from JSON file containing base64 data
function convertFromJsonFile(inputFile, outputFile, mulawFile = null) {
  try {
    console.log(`📖 Reading JSON file: ${inputFile}`);
    const rawData = fs.readFileSync(inputFile, 'utf8');
    const jsonData = JSON.parse(rawData);
    
    // Extract base64 data from various JSON structures
    let base64Data = extractBase64FromJson(jsonData);
    
    if (!base64Data) {
      throw new Error('No base64 audio data found in JSON file');
    }
    
    const converter = new Base64ToWavConverter();
    
    // Optionally save intermediate μ-law file
    if (mulawFile) {
      converter.saveMulawFile(base64Data, mulawFile);
    }
    
    converter.convertBase64ToWav(base64Data, outputFile);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Convert from raw base64 text file
function convertFromBase64File(inputFile, outputFile, mulawFile = null) {
  try {
    console.log(`📖 Reading base64 file: ${inputFile}`);
    const base64Data = fs.readFileSync(inputFile, 'utf8').trim();
    
    const converter = new Base64ToWavConverter();
    
    // Optionally save intermediate μ-law file
    if (mulawFile) {
      converter.saveMulawFile(base64Data, mulawFile);
    }
    
    converter.convertBase64ToWav(base64Data, outputFile);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Convert from direct base64 string
function convertFromBase64String(base64String, outputFile, mulawFile = null) {
  try {
    const converter = new Base64ToWavConverter();
    
    // Optionally save intermediate μ-law file
    if (mulawFile) {
      converter.saveMulawFile(base64String, mulawFile);
    }
    
    converter.convertBase64ToWav(base64String, outputFile);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Extract base64 data from JSON (handles arrays and objects)
function extractBase64FromJson(jsonData) {
  if (typeof jsonData === 'string') {
    return jsonData;
  }
  
  if (Array.isArray(jsonData)) {
    // Concatenate all base64 chunks from array
    const chunks = [];
    jsonData.forEach(item => {
      const chunk = extractBase64FromJson(item);
      if (chunk) chunks.push(chunk);
    });
    return chunks.join('');
  }
  
  if (typeof jsonData === 'object' && jsonData !== null) {
    // Try common field names
    const fields = ['payload', 'data', 'audio', 'base64', 'content'];
    
    for (const field of fields) {
      if (jsonData[field]) {
        return jsonData[field];
      }
    }
    
    // Try nested structures (like Twilio WebSocket format)
    if (jsonData.media && jsonData.media.payload) {
      return jsonData.media.payload;
    }
    
    // Search recursively in object
    for (const key in jsonData) {
      const result = extractBase64FromJson(jsonData[key]);
      if (result) return result;
    }
  }
  
  return null;
}

// Command line interface
function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
🎵 Base64 to WAV Converter

Usage:
  node base64-to-wav.js <input> <output.wav> [mulaw-output]

Input types:
  📄 JSON file:     input.json output.wav
  📝 Text file:     input.txt output.wav  
  💬 Direct:        "base64string..." output.wav

Options:
  [mulaw-output]    Optional: Save intermediate μ-law file

Examples:
  node base64-to-wav.js audio.json audio.wav
  node base64-to-wav.js audio.json audio.wav audio.mulaw
  node base64-to-wav.js base64.txt audio.wav
  node base64-to-wav.js "dGVzdGRhdGE=" test.wav

Supported JSON structures:
  { "payload": "base64..." }
  { "media": { "payload": "base64..." } }
  { "data": "base64..." }
  ["base64chunk1", "base64chunk2", ...]
  [{"payload": "chunk1"}, {"payload": "chunk2"}]
    `);
    process.exit(1);
  }
  
  const input = args[0];
  const outputWav = args[1];
  const outputMulaw = args[2] || null;
  
  console.log(`🎯 Input: ${input}`);
  console.log(`🎯 Output WAV: ${outputWav}`);
  if (outputMulaw) {
    console.log(`🎯 Output μ-law: ${outputMulaw}`);
  }
  
  // Determine input type
  if (fs.existsSync(input)) {
    // File input
    const ext = path.extname(input).toLowerCase();
    
    if (ext === '.json') {
      convertFromJsonFile(input, outputWav, outputMulaw);
    } else {
      // Assume text file with base64 content
      convertFromBase64File(input, outputWav, outputMulaw);
    }
  } else {
    // Direct base64 string input
    convertFromBase64String(input, outputWav, outputMulaw);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = { 
  Base64ToWavConverter, 
  convertFromJsonFile, 
  convertFromBase64File, 
  convertFromBase64String,
  extractBase64FromJson 
};