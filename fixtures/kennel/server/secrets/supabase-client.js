// Kennel bug S02: a Supabase-style service_role JWT shipped to the browser.
// The token is obviously FAKE (fake project ref, fake signature) and grants nothing anywhere.
window.kennelDatabase = {
  url: "http://127.0.0.1:54321",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicmVmIjoia2VubmVsRkFLRXByb2plY3QiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDAsIm5vdGUiOiJGQUtFIGtleSBmb3IgUnVuIEhvdW5kIHRlc3RzIn0.FAKEsignatureFAKEsignatureFAKEsignature00",
};
