// Kennel bug S01: an LLM-provider-shaped API key shipped to the browser.
// The key is obviously FAKE and only exists so Run Hound's bundle-secrets check has something to find.
window.kennelAssistant = {
  provider: "openai-compatible",
  model: "gpt-demo",
  apiKey: "sk-proj-FAKEFAKEkennelDemoOnly0000000000FAKE",
};
