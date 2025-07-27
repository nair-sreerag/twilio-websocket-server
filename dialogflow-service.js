const { SessionsClient } = require("@google-cloud/dialogflow-cx");

class DialogflowCXService {
  constructor() {
    this.projectId = 'cropmind-89afe';
    this.location = 'asia-south1';
    this.agentId = '244195e6-3766-4120-885b-54716cf417db';
    this.languageCode = 'en';
    this.apiEndpoint = 'asia-south1-dialogflow.googleapis.com';
    
    // Initialize the Dialogflow CX Sessions client
    this.sessionClient = new SessionsClient({
      projectId: this.projectId,
      apiEndpoint: this.apiEndpoint
    });
    
    console.log("✅ DialogflowCX Service initialized");
    console.log(`🏢 Project: ${this.projectId}`);
    console.log(`📍 Location: ${this.location}`);
    console.log(`🤖 Agent ID: ${this.agentId}`);
  }

  async sendMessage(message, sessionId, languageCode = this.languageCode) {
    try {
      console.log(`📤 Sending to Dialogflow: "${message}"`);
      console.log(`🆔 Session ID: ${sessionId}`);
      
      const sessionPath = this.sessionClient.projectLocationAgentSessionPath(
        this.projectId,
        this.location,
        this.agentId,
        sessionId
      );

      const request = {
        session: sessionPath,
        queryInput: {
          text: {
            text: message,
          },
          languageCode: languageCode,
        },
      };

      const [response] = await this.sessionClient.detectIntent(request);
      const result = this.formatResponse(response);
      
      return result;

    } catch (error) {
      console.error("❌ Dialogflow CX Error:", error.message);
      
      if (error.message.includes('Could not load the default credentials')) {
        console.error(`
🔧 Authentication Setup Required:
1. Download service account key from Google Cloud Console
2. Set: export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
3. Or run: gcloud auth application-default login
        `);
      }
      
      return {
        success: false,
        error: error.message,
        messages: ["Sorry, I'm having trouble connecting to the conversation service."]
      };
    }
  }

  formatResponse(response) {
    const queryResult = response.queryResult;
    
    const messages = [];
    if (queryResult.responseMessages) {
      queryResult.responseMessages.forEach(message => {
        if (message.text && message.text.text) {
          messages.push(...message.text.text);
        }
      });
    }

    const intent = queryResult.intent ? {
      name: queryResult.intent.name,
      displayName: queryResult.intent.displayName,
      confidence: queryResult.intentDetectionConfidence || 0
    } : null;

    const parameters = queryResult.parameters || {};

    const currentPage = queryResult.currentPage ? {
      name: queryResult.currentPage.name,
      displayName: queryResult.currentPage.displayName
    } : null;

    return {
      success: true,
      sessionId: response.responseId,
      messages: messages,
      intent: intent,
      parameters: parameters,
      currentPage: currentPage,
      languageCode: queryResult.languageCode,
      raw: {
        queryText: queryResult.text,
        confidence: queryResult.intentDetectionConfidence
      }
    };
  }

  /**
   * Generate a session ID from phone number
   * @param {string} phoneNumber - Phone number to convert to session ID
   * @returns {string} Session ID
   */
  generateSessionIdFromPhone(phoneNumber) {
    return phoneNumber.replace(/\+/g, '').replace(/\s/g, '').replace(/\-/g, '');
  }

  /**
   * Create a unique session ID
   * @param {string} userId - User identifier (optional)
   * @returns {string} Unique session ID
   */
  generateSessionId(userId = null) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return userId ? `${userId}_${timestamp}` : `session_${timestamp}_${random}`;
  }
}

module.exports = { DialogflowCXService }; 