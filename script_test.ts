import fs from 'fs';

const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyiEns9GDoPmwDTKM7WdmMghaKrB_K_QQ2CBuW__0CyZC2GS-axQOSC0H4WrUoW2A2xPQ/exec";

async function testEndpoint() {
  const batchPayload = {
    action: "BATCH",
    payloads: [
      { action: "ADD", id: "test_b_1", userid: "tester", text: "test batch 1", timestamp: Date.now(), starred: 0 },
      { action: "ADD", id: "test_b_2", userid: "tester", text: "test batch 2", timestamp: Date.now(), starred: 0 }
    ]
  };

  console.log("Firing BATCH...");
  await fetch(GOOGLE_SHEETS_URL, { method: "POST", body: JSON.stringify(batchPayload) });
  
  // wait 2 seconds
  await new Promise(r => setTimeout(r, 2000));
  
  let res = await fetch(GOOGLE_SHEETS_URL);
  let j = await res.json();
  let latest = j.slice(-10);
  console.log(latest.map((row: any) => row[2]).filter((t: any) => typeof t === 'string' && t.includes('test batch')));
}

testEndpoint();
