#!/usr/bin/env node

const fs = require('fs');

class TwilioAudioDiagnostics {
  analyzeBase64Issues(jsonArray) {
    console.log('🔍 DIAGNOSING BASE64 ISSUES:');
    
    const mediaMessages = jsonArray.filter(msg => 
      msg.event === 'media' && msg.media && msg.media.payload
    );
    
    console.log(`📊 Found ${mediaMessages.length} media messages`);
    
    // Check first few payloads individually
    const samples = mediaMessages.slice(0, 5);
    
    samples.forEach((msg, i) => {
      const payload = msg.media.payload;
      console.log(`\n📋 Sample ${i + 1}:`);
      console.log(`  Sequence: ${msg.sequenceNumber}`);
      console.log(`  Payload length: ${payload.length} chars`);
      console.log(`  First 50 chars: "${payload.substring(0, 50)}"`);
      console.log(`  Last 50 chars: "${payload.substring(payload.length - 50)}"`);
      
      try {
        const decoded = Buffer.from(payload, 'base64');
        console.log(`  ✅ Decodes to: ${decoded.length} bytes`);
        
        // Show first few bytes
        const firstBytes = Array.from(decoded.slice(0, 10))
          .map(b => `0x${b.toString(16).padStart(2, '0')}`)
          .join(' ');
        console.log(`  First bytes: ${firstBytes}`);
        
        // Check if it's valid base64
        const reencoded = decoded.toString('base64');
        const isValid = reencoded === payload;
        console.log(`  Valid base64: ${isValid ? '✅' : '❌'}`);
        
      } catch (error) {
        console.log(`  ❌ Decode error: ${error.message}`);
      }
    });
    
    // Test combining them
    console.log(`\n🔗 TESTING COMBINATION:`);
    const combinedPayload = mediaMessages
      .sort((a, b) => parseInt(a.sequenceNumber) - parseInt(b.sequenceNumber))
      .map(msg => msg.media.payload)
      .join('');
    
    console.log(`📊 Combined length: ${combinedPayload.length} chars`);
    console.log(`📊 Expected bytes: ${(combinedPayload.length * 3) / 4} (if valid base64)`);
    
    try {
      const decoded = Buffer.from(combinedPayload, 'base64');
      console.log(`📊 Actual decoded: ${decoded.length} bytes`);
      console.log(`❗ Efficiency: ${((decoded.length * 4) / combinedPayload.length * 100).toFixed(1)}% (should be ~75%)`);
      
      // Check for patterns that might indicate issues
      const nullBytes = decoded.filter(b => b === 0).length;
      const sameBytes = decoded.every(b => b === decoded[0]);
      
      console.log(`🔍 Analysis:`);
      console.log(`  Null bytes: ${nullBytes}/${decoded.length} (${(nullBytes/decoded.length*100).toFixed(1)}%)`);
      console.log(`  All same byte: ${sameBytes ? '❌ Yes' : '✅ No'}`);
      
    } catch (error) {
      console.log(`❌ Combined decode error: ${error.message}`);
    }
    
    // Test alternative approach - decode each individually
    console.log(`\n🔄 ALTERNATIVE APPROACH:`);
    let totalBytes = 0;
    let validCount = 0;
    
    const allBuffers = [];
    
    mediaMessages.forEach((msg, i) => {
      try {
        const decoded = Buffer.from(msg.media.payload, 'base64');
        allBuffers.push(decoded);
        totalBytes += decoded.length;
        validCount++;
      } catch (error) {
        console.log(`❌ Message ${i + 1} failed to decode: ${error.message}`);
      }
    });
    
    console.log(`✅ Successfully decoded: ${validCount}/${mediaMessages.length} messages`);
    console.log(`📊 Total bytes from individual decoding: ${totalBytes}`);
    console.log(`📊 Expected duration: ~${(totalBytes / 8000).toFixed(2)} seconds`);
    
    if (totalBytes > 160) {
      console.log(`\n💡 SOLUTION: Decode messages individually, then combine buffers`);
      return allBuffers;
    }
    
    return null;
  }
}

// Test diagnostic
function main() {
  const inputFile = process.argv[2] || 'audio_2.json';
  
  try {
    console.log(`📖 Reading: ${inputFile}`);
    const jsonData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    
    const diagnostics = new TwilioAudioDiagnostics();
    const buffers = diagnostics.analyzeBase64Issues(jsonData);
    
    if (buffers && buffers.length > 0) {
      // Create corrected WAV file
      const combinedBuffer = Buffer.concat(buffers);
      console.log(`\n🎵 Creating corrected WAV file...`);
      console.log(`📊 Total audio data: ${combinedBuffer.length} bytes`);
      console.log(`📊 Duration: ~${(combinedBuffer.length / 8000).toFixed(2)} seconds`);
      
      // TODO: Add the PCM conversion and WAV creation here
      // For now, just save the raw μ-law data
      fs.writeFileSync('debug_raw_mulaw.bin', combinedBuffer);
      console.log(`💾 Saved raw μ-law data to: debug_raw_mulaw.bin`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  main();
}