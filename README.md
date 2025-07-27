# 🎙️ Real-Time Phone Call AI Assistant

A WebSocket-based server that provides real-time speech transcription and AI-powered conversation capabilities for Twilio phone calls. This system streams audio chunks from phone calls, transcribes them using Google Cloud Speech-to-Text, and processes conversations through Dialogflow CX to create an intelligent phone assistant.

## 🏗️ Architecture Overview

```
Phone Call → Twilio → WebSocket Server → Google Speech API → Dialogflow CX → Response
     ↑                                                                              ↓
     ←── Audio Response ←── Google TTS ←── AI Processing ←── Transcription ←────────┘
```

The server acts as a bridge between Twilio's media streams and Google Cloud AI services, enabling real-time conversational AI over phone calls.

## ✨ Key Features

### 🎯 **Real-Time Audio Processing**

- Streams audio chunks from Twilio calls via WebSocket
- Processes μ-law encoded audio at 8kHz sample rate
- Optimized for phone call audio quality with Google's `phone_call` model

### 🌍 **Multi-Language Support**

- Automatic language detection across 9+ languages
- Sequential language testing for optimal recognition
- Supports: English, Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Hindi

### 🤖 **AI-Powered Conversations**

- Integration with Google Dialogflow CX
- Context-aware conversation management
- Session-based interaction tracking

### 🔊 **Bidirectional Communication**

- Speech-to-Text for incoming audio
- Text-to-Speech for AI responses
- Real-time audio streaming back to callers

### 📊 **Advanced Monitoring**

- Real-time transcription logging
- Confidence scoring for speech recognition
- Detailed call analytics and metrics
- Language detection reporting

## 🚀 Quick Start

### Prerequisites

- Node.js (v14 or higher)
- Google Cloud Platform account with enabled APIs:
  - Cloud Speech-to-Text API
  - Dialogflow CX API
  - Cloud Text-to-Speech API
- Twilio account
- ngrok (for local development)

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd hackathon-websocket
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure Google Cloud Authentication**

   ```bash
   # Option 1: Service Account Key
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"

   # Option 2: Application Default Credentials
   gcloud auth application-default login
   ```

4. **Start the server**

   ```bash
   node working_stt.js
   ```

5. **Expose server with ngrok (for development)**

   ```bash
   ngrok http 8081
   ```

6. **Update WebSocket URL**
   - Copy the ngrok URL (e.g., `wss://abc123.ngrok-free.app`)
   - Update `templates/streams.xml` with your WebSocket URL

## 🔧 Configuration

### Environment Variables

```bash
PORT=8081                    # Server port (default: 8081)
GOOGLE_APPLICATION_CREDENTIALS="path/to/key.json"  # Google Cloud credentials
```

### Dialogflow CX Setup

Update `dialogflow-service.js` with your project details:

```javascript
this.projectId = "your-project-id";
this.location = "your-location";
this.agentId = "your-agent-id";
```

## 📡 API Endpoints

### `POST /twiml`

Returns TwiML instructions for Twilio to stream call audio to the WebSocket server.

**Response**: XML (TwiML)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://your-domain.com" track="inbound_track" />
  </Start>
  <Say>Please speak after the beep.</Say>
  <Pause length="100" />
  <Hangup/>
</Response>
```

### `GET /ping`

Health check endpoint.

**Response**: `"Phone call transcription ready!"`

### `GET /`

Server status endpoint.

**Response**: `"Fixed Phone Call Model Transcription Server is running!"`

## 🌐 WebSocket Protocol

The server accepts WebSocket connections from Twilio and processes the following message types:

### Incoming Messages (from Twilio)

```javascript
// Connection established
{
  "event": "connected",
  "protocol": "Call"
}

// Call started
{
  "event": "start",
  "start": {
    "callSid": "CA...",
    "streamSid": "MZ..."
  }
}

// Audio data
{
  "event": "media",
  "media": {
    "timestamp": "1234567890",
    "chunk": "1",
    "payload": "base64-encoded-audio"
  }
}

// Call ended
{
  "event": "stop"
}
```

### Outgoing Messages (to Twilio)

```javascript
// Send audio response back to caller
{
  "event": "media",
  "streamSid": "MZ...",
  "media": {
    "payload": "base64-encoded-audio"
  }
}
```

## 🎵 Audio Processing Pipeline

1. **Receive Audio**: μ-law encoded chunks at 8kHz from Twilio
2. **Language Detection**: Automatic detection across supported languages
3. **Speech Recognition**: Google Cloud Speech-to-Text with phone_call model
4. **AI Processing**: Dialogflow CX for intent detection and response generation
5. **Text-to-Speech**: Google Cloud TTS for response audio
6. **Audio Streaming**: Send response back to caller via WebSocket

## 🌍 Supported Languages

| Language     | Code  | Detection |
| ------------ | ----- | --------- |
| English (US) | en-US | ✅        |
| Spanish      | es-ES | ✅        |
| French       | fr-FR | ✅        |
| German       | de-DE | ✅        |
| Italian      | it-IT | ✅        |
| Portuguese   | pt-BR | ✅        |
| Chinese      | zh-CN | ✅        |
| Japanese     | ja-JP | ✅        |
| Hindi        | hi-IN | ✅        |

## 📊 Monitoring & Logging

The server provides comprehensive logging including:

- **Real-time transcription**: Live transcript output with confidence scores
- **Language detection**: Automatic language identification process
- **Call metrics**: Duration, audio data processed, transcript segments
- **Error handling**: Detailed error logging for debugging

### Sample Output

```
🎙️  [2024-01-15T10:30:45.123Z] TRANSCRIPT [English (US)]: "Hello, how can I help you today?" (85.3%)
🤖 Sending to Dialogflow: "Hello, how can I help you today?"
🎯 AI Response: "Hi there! I'm your AI assistant. What can I do for you?"
🔊 Sent audio response back to caller
```

## 🛠️ Development

### Project Structure

```
hackathon-websocket/
├── working_stt.js          # Main server file
├── dialogflow-service.js   # Dialogflow CX integration
├── package.json           # Dependencies
├── templates/
│   └── streams.xml        # TwiML template
└── README.md             # This file
```

### Key Dependencies

- `@google-cloud/speech`: Speech-to-Text API
- `@google-cloud/dialogflow-cx`: Dialogflow CX integration
- `@google-cloud/text-to-speech`: Text-to-Speech API
- `websocket`: WebSocket server
- `express`: HTTP server
- `twilio`: Twilio SDK

## 🚨 Troubleshooting

### Common Issues

1. **WebSocket Connection Fails**

   - Ensure ngrok is running and URL is updated in `streams.xml`
   - Check firewall settings

2. **Speech Recognition Not Working**

   - Verify Google Cloud credentials
   - Ensure Speech-to-Text API is enabled
   - Check audio format (should be μ-law, 8kHz)

3. **Dialogflow Integration Issues**

   - Verify project ID, location, and agent ID in `dialogflow-service.js`
   - Ensure Dialogflow CX API is enabled
   - Check service account permissions

4. **Audio Quality Issues**
   - Phone calls use μ-law encoding at 8kHz
   - Consider network latency for real-time processing

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:

- Check the troubleshooting section above
- Review Google Cloud documentation
- Check Twilio media streams documentation
