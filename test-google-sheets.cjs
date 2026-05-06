async function test() {
  const url = "https://script.google.com/macros/s/AKfycbyiEns9GDoPmwDTKM7WdmMghaKrB_K_QQ2CBuW__0CyZC2GS-axQOSC0H4WrUoW2A2xPQ/exec";
  
  const getRes = await fetch(url, { method: "GET" });
  const data = await getRes.json();
  console.log("FINAL GET parsed:", data);
}
test();
