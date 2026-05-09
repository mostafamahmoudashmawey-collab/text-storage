import fs from 'fs';

const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyiEns9GDoPmwDTKM7WdmMghaKrB_K_QQ2CBuW__0CyZC2GS-axQOSC0H4WrUoW2A2xPQ/exec";

async function testEndpoint() {
  const p1 = { action: "ADD", id: "test_c_1", userid: "tester", text: "test concurrent 1", timestamp: Date.now(), starred: 0 };
  const p2 = { action: "ADD", id: "test_c_2", userid: "tester", text: "test concurrent 2", timestamp: Date.now(), starred: 0 };
  const p3 = { action: "ADD", id: "test_c_3", userid: "tester", text: "test concurrent 3", timestamp: Date.now(), starred: 0 };

  console.log("Firing concurrently...");
  await Promise.all([
    fetch(GOOGLE_SHEETS_URL, { method: "POST", body: JSON.stringify(p1) }),
    fetch(GOOGLE_SHEETS_URL, { method: "POST", body: JSON.stringify(p2) }),
    fetch(GOOGLE_SHEETS_URL, { method: "POST", body: JSON.stringify(p3) }),
  ]);
  
  // wait 2 seconds
  await new Promise(r => setTimeout(r, 2000));
  
  let res = await fetch(GOOGLE_SHEETS_URL);
  let j = await res.json();
  let latest = j.slice(-10);
  console.log(latest.map((row: any) => row[2]).filter((t: any) => typeof t === 'string' && t.includes('concurrent')));
}

testEndpoint();
