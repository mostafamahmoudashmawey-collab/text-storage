async function getSchema() {
  try {
    const res = await fetch('https://wesxjexuycdstmofcqim.supabase.co/rest/v1/users', {
      method: 'POST',
      headers: {
        'apikey': 'sb_publishable_P8oFAOEotsadARTUYZAVGw_STgiZcLG',
        'Authorization': 'Bearer sb_publishable_P8oFAOEotsadARTUYZAVGw_STgiZcLG',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({})
    });
    const data = await res.json();
    console.log(res.status, data);
  } catch (e) {
    console.error(e);
  }
}
getSchema();
