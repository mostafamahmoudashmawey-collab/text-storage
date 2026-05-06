const url = "https://script.google.com/macros/s/AKfycbyiEns9GDoPmwDTKM7WdmMghaKrB_K_QQ2CBuW__0CyZC2GS-axQOSC0H4WrUoW2A2xPQ/exec";
async function test() {
  const req = await fetch(url, {
    method: "GET",
    redirect: "follow",
  });
  console.log(await req.text());
}
test();
