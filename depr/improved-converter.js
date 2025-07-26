#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class AudioDiagnostics {
  static analyzeBase64(base64Data) {
    console.log('\n🔍 AUDIO DIAGNOSTICS:');
    console.log(`📊 Base64 length: ${base64Data.length} characters`);
    
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      console.log(`📊 Binary data: ${buffer.length} bytes`);
      console.log(`📊 Expected duration: ~${(buffer.length / 8000).toFixed(2)} seconds`);
      
      // Sample first few bytes
      const sample = Array.from(buffer.slice(0, 10)).map(b => `0x${b.toString(16).padStart(2, '0')}`);
      console.log(`📊 First 10 bytes: ${sample.join(' ')}`);
      
      // Check for patterns that might indicate issues
      const allZeros = buffer.every(b => b === 0);
      const allSame = buffer.every(b => b === buffer[0]);
      
      if (allZeros) console.log('⚠️  WARNING: All bytes are zero (silence)');
      if (allSame) console.log('⚠️  WARNING: All bytes are identical');
      
      return buffer;
    } catch (error) {
      console.error('❌ Error analyzing base64:', error.message);
      return null;
    }
  }
}

class ImprovedAudioConverter {
  constructor() {
    this.sampleRate = 8000;
    this.channels = 1;
    this.bitsPerSample = 16;
  }

  // Improved μ-law decoder with better handling
  mulawDecode(mulawByte) {
    // ITU-T G.711 standard μ-law decompression
    const BIAS = 0x84;
    const CLIP = 32635;
    
    // Complement (invert all bits)
    mulawByte = (~mulawByte) & 0xFF;
    
    // Extract sign, exponent, and mantissa
    const sign = (mulawByte & 0x80);
    const exponent = (mulawByte >> 4) & 0x07;
    const mantissa = mulawByte & 0x0F;
    
    // Calculate the linear value
    let linearValue;
    
    if (exponent === 0) {
      // Special case for exponent 0
      linearValue = (mantissa << 4) + BIAS;
    } else {
      // Standard case
      linearValue = ((mantissa | 0x10) << (exponent + 3)) + BIAS;
    }
    
    // Apply sign
    if (sign) {
      linearValue = -linearValue;
    }
    
    // Clip to prevent overflow
    return Math.max(-CLIP, Math.min(CLIP, linearValue));
  }

  // Alternative μ-law decoder implementation
  mulawDecodeAlt(mulawByte) {
    // μ-law lookup table (faster but uses more memory)
    const MULAW_TABLE = this.generateMulawTable();
    return MULAW_TABLE[mulawByte];
  }

  generateMulawTable() {
    const table = new Array(256);
    const BIAS = 0x84;
    
    for (let i = 0; i < 256; i++) {
      let mulawByte = (~i) & 0xFF;
      let sign = (mulawByte & 0x80);
      let exponent = (mulawByte >> 4) & 0x07;
      let mantissa = mulawByte & 0x0F;
      
      let sample = mantissa << (exponent + 3);
      sample += BIAS;
      
      if (sign) sample = -sample;
      
      table[i] = Math.max(-32768, Math.min(32767, sample));
    }
    
    return table;
  }

  mulawToPcm(mulawBuffer, useAltDecoder = false) {
    const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);
    
    for (let i = 0; i < mulawBuffer.length; i++) {
      const pcmValue = useAltDecoder ? 
        this.mulawDecodeAlt(mulawBuffer[i]) : 
        this.mulawDecode(mulawBuffer[i]);
      
      pcmBuffer.writeInt16LE(pcmValue, i * 2);
    }
    
    return pcmBuffer;
  }

  createWavHeader(dataSize) {
    const buffer = Buffer.alloc(44);
    let offset = 0;
    
    // RIFF header
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;
    
    // Format chunk
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4;
    buffer.writeUInt16LE(1, offset); offset += 2;  // PCM format
    buffer.writeUInt16LE(this.channels, offset); offset += 2;
    buffer.writeUInt32LE(this.sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(this.sampleRate * this.channels * (this.bitsPerSample / 8), offset); offset += 4;
    buffer.writeUInt16LE(this.channels * (this.bitsPerSample / 8), offset); offset += 2;
    buffer.writeUInt16LE(this.bitsPerSample, offset); offset += 2;
    
    // Data chunk
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;
    
    return buffer;
  }

  convertWithDiagnostics(base64Data, outputPath, options = {}) {
    console.log('🎵 IMPROVED AUDIO CONVERTER');
    console.log('=' .repeat(50));
    
    // Analyze input data
    const mulawBuffer = AudioDiagnostics.analyzeBase64(base64Data);
    if (!mulawBuffer) return false;
    
    console.log('\n🔄 CONVERSION PROCESS:');
    
    // Try both decoders
    const useAltDecoder = options.useAltDecoder || false;
    console.log(`🔧 Using ${useAltDecoder ? 'lookup table' : 'standard'} decoder`);
    
    const pcmBuffer = this.mulawToPcm(mulawBuffer, useAltDecoder);
    console.log(`✅ Converted to PCM: ${pcmBuffer.length} bytes`);
    
    // Apply gain if specified
    if (options.gain && options.gain !== 1.0) {
      this.applyGain(pcmBuffer, options.gain);
      console.log(`🔊 Applied gain: ${options.gain}x`);
    }
    
    // Create WAV file
    const wavHeader = this.createWavHeader(pcmBuffer.length);
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
    
    fs.writeFileSync(outputPath, wavBuffer);
    
    const duration = (mulawBuffer.length / this.sampleRate).toFixed(2);
    console.log(`\n✅ CONVERSION COMPLETE:`);
    console.log(`📁 File: ${outputPath}`);
    console.log(`📊 Duration: ${duration} seconds`);
    console.log(`📊 File size: ${(wavBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`🎧 Format: ${this.sampleRate}Hz, ${this.channels}ch, ${this.bitsPerSample}-bit PCM`);
    
    // Save diagnostic files if requested
    if (options.saveDiagnostics) {
      this.saveDiagnosticFiles(mulawBuffer, pcmBuffer, outputPath);
    }
    
    return true;
  }

  applyGain(pcmBuffer, gain) {
    for (let i = 0; i < pcmBuffer.length; i += 2) {
      let sample = pcmBuffer.readInt16LE(i);
      sample = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
      pcmBuffer.writeInt16LE(sample, i);
    }
  }

  saveDiagnosticFiles(mulawBuffer, pcmBuffer, basePath) {
    const baseDir = path.dirname(basePath);
    const baseName = path.basename(basePath, '.wav');
    
    // Save raw μ-law
    const mulawPath = path.join(baseDir, `${baseName}_debug.mulaw`);
    fs.writeFileSync(mulawPath, mulawBuffer);
    console.log(`💾 Saved μ-law debug file: ${mulawPath}`);
    
    // Save raw PCM
    const pcmPath = path.join(baseDir, `${baseName}_debug.pcm`);
    fs.writeFileSync(pcmPath, pcmBuffer);
    console.log(`💾 Saved PCM debug file: ${pcmPath}`);
  }
}

// Helper functions for different input types
function extractBase64FromJson(jsonData) {
  if (typeof jsonData === 'string') return jsonData;
  
  if (Array.isArray(jsonData)) {
    const chunks = jsonData
      .map(item => extractBase64FromJson(item))
      .filter(chunk => chunk && chunk.length > 0);
    return chunks.join('');
  }
  
  if (jsonData && typeof jsonData === 'object') {
    // Try common field names
    const fields = ['payload', 'data', 'audio', 'base64'];
    for (const field of fields) {
      if (jsonData[field]) return jsonData[field];
    }
    
    // Try Twilio format
    if (jsonData.media && jsonData.media.payload) {
      return jsonData.media.payload;
    }
    
    // Search recursively
    for (const key in jsonData) {
      const result = extractBase64FromJson(jsonData[key]);
      if (result) return result;
    }
  }
  
  return null;
}

function convertFromFile(inputFile, outputFile, options = {}) {
  console.log(`📖 Reading: ${inputFile}`);
  
  let base64Data;
  const ext = path.extname(inputFile).toLowerCase();
  
  if (ext === '.json') {
    const jsonData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    base64Data = extractBase64FromJson(jsonData);
    if (!base64Data) {
      throw new Error('No base64 audio data found in JSON');
    }
  } else {
    base64Data = fs.readFileSync(inputFile, 'utf8').trim();
  }
  
  const converter = new ImprovedAudioConverter();
  return converter.convertWithDiagnostics(base64Data, outputFile, options);
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
🎵 Improved Base64 to WAV Converter

Usage:
  node improved-converter.js <input> <output.wav> [options]

Options:
  --gain=<number>        Apply gain multiplier (e.g., --gain=2.0)
  --alt-decoder          Use lookup table decoder instead of standard
  --debug                Save diagnostic files (.mulaw, .pcm)
  --help                 Show this help

Examples:
  node improved-converter.js audio.json output.wav
  node improved-converter.js audio.json output.wav --gain=1.5 --debug
  node improved-converter.js "base64string..." output.wav --alt-decoder

Troubleshooting:
  - If audio is too quiet, try --gain=2.0 or higher
  - If audio sounds wrong, try --alt-decoder
  - Use --debug to save intermediate files for analysis
    `);
    process.exit(1);
  }
  
  const input = args[0];
  const output = args[1];
  
  // Parse options
  const options = {};
  args.slice(2).forEach(arg => {
    if (arg.startsWith('--gain=')) {
      options.gain = parseFloat(arg.split('=')[1]);
    } else if (arg === '--alt-decoder') {
      options.useAltDecoder = true;
    } else if (arg === '--debug') {
      options.saveDiagnostics = true;
    }
  });
  
  try {
    if (fs.existsSync(input)) {
      convertFromFile(input, output, options);
    } else {
      // Direct base64 string
      const converter = new ImprovedAudioConverter();
      converter.convertWithDiagnostics(input, output, options);
    }
    
    console.log('\n🎉 Try playing the WAV file with your media player!');
    console.log('💡 If you still can\'t hear anything, try:');
    console.log('   • --gain=3.0 (increase volume)');
    console.log('   • --alt-decoder (different decoding method)');
    console.log('   • --debug (save intermediate files for analysis)');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ImprovedAudioConverter, AudioDiagnostics };