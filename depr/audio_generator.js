#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class AudioStitcher {
  constructor() {
    this.audioChunks = [];
  }

  // Add audio chunk from base64 string
  addChunk(base64Chunk) {
    this.audioChunks.push(base64Chunk);
  }

  // Create WAV file from all chunks
  createWavFile(outputPath) {
    if (this.audioChunks.length === 0) {
      throw new Error('No audio chunks to process');
    }

    console.log(`Processing ${this.audioChunks.length} audio chunks...`);

    // Step 1: Concatenate all base64 chunks
    const allAudioData = this.audioChunks.join('');
    
    // Step 2: Decode base64 to get raw μ-law bytes
    const mulawBuffer = Buffer.from(allAudioData, 'base64');
    console.log(`Total μ-law data: ${mulawBuffer.length} bytes`);
    
    // Step 3: Convert μ-law to linear PCM
    const pcmBuffer = this.mulawToPcm(mulawBuffer);
    
    // Step 4: Create WAV file with proper header
    const wavBuffer = this.createWavBuffer(pcmBuffer, 8000, 1, 16);
    
    // Step 5: Write to file
    fs.writeFileSync(outputPath, wavBuffer);
    
    const durationSeconds = (mulawBuffer.length / 8000).toFixed(2);
    console.log(`✅ Audio file created: ${outputPath}`);
    console.log(`📊 Duration: ${durationSeconds} seconds`);
    console.log(`📁 File size: ${(wavBuffer.length / 1024).toFixed(2)} KB`);
  }

  // Convert μ-law bytes to linear PCM
  mulawToPcm(mulawBuffer) {
    const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2); // 8-bit to 16-bit
    
    for (let i = 0; i < mulawBuffer.length; i++) {
      const mulawByte = mulawBuffer[i];
      const pcmValue = this.mulawDecode(mulawByte);
      pcmBuffer.writeInt16LE(pcmValue, i * 2);
    }
    
    return pcmBuffer;
  }

  // μ-law decode algorithm
  mulawDecode(mulawByte) {
    const BIAS = 0x84;
    const CLIP = 32635;
    
    // Invert all bits (μ-law is stored inverted)
    mulawByte = ~mulawByte;
    
    // Extract components
    const sign = (mulawByte & 0x80); // Sign bit
    const exponent = (mulawByte >> 4) & 0x07; // 3-bit exponent
    const mantissa = mulawByte & 0x0F; // 4-bit mantissa
    
    // Reconstruct linear value
    let sample = mantissa << (exponent + 3);
    sample += BIAS;
    
    // Apply sign
    if (sign) sample = -sample;
    
    // Clip to prevent overflow
    return Math.max(-CLIP, Math.min(CLIP, sample));
  }

  // Create WAV file header + data
  createWavBuffer(pcmData, sampleRate, channels, bitsPerSample) {
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;
    
    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;
    
    // RIFF header
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;
    
    // Format chunk
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // Chunk size
    buffer.writeUInt16LE(1, offset); offset += 2;  // Audio format (PCM)
    buffer.writeUInt16LE(channels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
    
    // Data chunk
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;
    
    // Audio data
    pcmData.copy(buffer, offset);
    
    return buffer;
  }

  // Reset for new recording
  reset() {
    this.audioChunks = [];
  }
}

// Enhanced function to extract audio payload from different JSON structures
function extractAudioPayload(jsonData) {
  // Handle arrays of objects
  if (Array.isArray(jsonData)) {
    console.log(`📦 Processing array with ${jsonData.length} items`);
    const payloads = [];
    
    jsonData.forEach((item, index) => {
      try {
        const payload = extractAudioPayload(item);
        if (payload) {
          payloads.push(payload);
          console.log(`  ✅ Item ${index + 1}: Found audio payload (${payload.length} chars)`);
        } else {
          console.log(`  ⚠️  Item ${index + 1}: No audio payload found`);
        }
      } catch (error) {
        console.log(`  ❌ Item ${index + 1}: Error - ${error.message}`);
      }
    });
    
    return payloads.join('');
  }
  
  // Handle single objects
  if (typeof jsonData === 'object' && jsonData !== null) {
    // Common Twilio WebSocket structure
    if (jsonData.event === 'media' && jsonData.media && jsonData.media.payload) {
      return jsonData.media.payload;
    }
    
    // Direct payload field
    if (jsonData.payload) {
      return jsonData.payload;
    }
    
    // Other common field names
    if (jsonData.data) {
      return jsonData.data;
    }
    
    if (jsonData.audio) {
      return jsonData.audio;
    }
    
    if (jsonData.base64) {
      return jsonData.base64;
    }
    
    // Check for nested media events in objects
    if (jsonData.media) {
      return extractAudioPayload(jsonData.media);
    }
    
    // If object has timestamp/sequence and payload (common pattern)
    if (jsonData.streamSid || jsonData.accountSid) {
      // This looks like a Twilio event, search for payload in any nested structure
      const searchForPayload = (obj) => {
        if (obj && typeof obj === 'object') {
          if (obj.payload) return obj.payload;
          for (const key in obj) {
            const result = searchForPayload(obj[key]);
            if (result) return result;
          }
        }
        return null;
      };
      
      const foundPayload = searchForPayload(jsonData);
      if (foundPayload) return foundPayload;
    }
    
    console.log(`⚠️  Unknown object structure:`, Object.keys(jsonData));
    return null;
  }
  
  // Handle raw string
  if (typeof jsonData === 'string') {
    // Check if it looks like base64 (basic validation)
    if (jsonData.length > 0 && /^[A-Za-z0-9+/=]+$/.test(jsonData)) {
      return jsonData;
    }
    console.log(`⚠️  String doesn't look like base64:`, jsonData.substring(0, 50) + '...');
    return null;
  }
  
  console.log(`⚠️  Unsupported data type:`, typeof jsonData);
  return null;
}

// Main function to stitch audio from JSON files
function stitchAudioFromFiles(inputFiles, outputFile) {
  const stitcher = new AudioStitcher();
  
  console.log(`🎵 Starting audio stitching process...`);
  console.log(`📂 Input files: ${inputFiles.length}`);
  
  inputFiles.forEach((file, index) => {
    try {
      console.log(`\n📖 Reading file ${index + 1}/${inputFiles.length}: ${file}`);
      
      if (!fs.existsSync(file)) {
        console.error(`❌ File not found: ${file}`);
        return;
      }
      
      const rawData = fs.readFileSync(file, 'utf8');
      const jsonData = JSON.parse(rawData);
      
      // Detect structure type
      if (Array.isArray(jsonData)) {
        console.log(`📋 File contains array with ${jsonData.length} items`);
      } else {
        console.log(`📄 File contains single object`);
      }
      
      const audioPayload = extractAudioPayload(jsonData);
      
      if (audioPayload && audioPayload.length > 0) {
        stitcher.addChunk(audioPayload);
        console.log(`✅ Added audio data from ${file} (${audioPayload.length} chars)`);
      } else {
        console.warn(`⚠️  No audio data found in ${file}`);
      }
      
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error(`❌ Invalid JSON in ${file}:`, error.message);
      } else {
        console.error(`❌ Error processing ${file}:`, error.message);
      }
    }
  });
  
  if (stitcher.audioChunks.length === 0) {
    console.error('\n❌ No audio chunks found to process!');
    console.error('💡 Make sure your JSON files contain base64 audio data in supported formats.');
    process.exit(1);
  }
  
  try {
    console.log(`\n🔧 Creating WAV file...`);
    stitcher.createWavFile(outputFile);
  } catch (error) {
    console.error('❌ Error creating WAV file:', error.message);
    process.exit(1);
  }
}

// Command line interface
function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
🎵 Audio Stitcher - Combine Twilio audio chunks into WAV file

Usage:
  node audio-stitcher.js <output.wav> <input1.json> [input2.json] [...]
  node audio-stitcher.js <output.wav> <pattern>

Examples:
  node audio-stitcher.js complete-call.wav audio_data_1.json audio_data_2.json
  node audio-stitcher.js call.wav audio_data_*.json

Supported JSON structures:

📄 Single Objects:
  { "media": { "payload": "base64data..." } }     (Twilio WebSocket)
  { "payload": "base64data..." }                  (Simple payload)
  { "data": "base64data..." }                     (Data field)
  "base64data..."                                 (Raw string)

📋 Arrays:
  [                                               (Array of any above)
    { "media": { "payload": "base64data1..." } },
    { "media": { "payload": "base64data2..." } },
    { "media": { "payload": "base64data3..." } }
  ]

📦 Mixed Arrays:
  [
    { "event": "media", "media": { "payload": "..." } },
    { "event": "start", "streamSid": "..." },       (Non-audio events ignored)
    { "event": "media", "media": { "payload": "..." } }
  ]
    `);
    process.exit(1);
  }
  
  const outputFile = args[0];
  const inputPattern = args.slice(1);
  
  // Expand glob patterns or use files as-is
  let inputFiles = [];
  
  inputPattern.forEach(pattern => {
    if (pattern.includes('*')) {
      // Simple glob expansion for *.json patterns
      const dir = path.dirname(pattern) || '.';
      const baseName = path.basename(pattern).replace('*', '');
      
      try {
        const files = fs.readdirSync(dir)
          .filter(file => file.includes(baseName.replace('.json', '')) && file.endsWith('.json'))
          .map(file => path.join(dir, file))
          .sort(); // Sort to ensure proper order
        
        inputFiles.push(...files);
      } catch (error) {
        console.error(`❌ Error reading directory for pattern ${pattern}:`, error.message);
      }
    } else {
      inputFiles.push(pattern);
    }
  });
  
  if (inputFiles.length === 0) {
    console.error('❌ No input files found!');
    process.exit(1);
  }
  
  // Remove duplicates and sort
  inputFiles = [...new Set(inputFiles)].sort();
  
  console.log(`🎯 Output file: ${outputFile}`);
  console.log(`📁 Found ${inputFiles.length} input files`);
  
  stitchAudioFromFiles(inputFiles, outputFile);
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = { AudioStitcher, stitchAudioFromFiles, extractAudioPayload };