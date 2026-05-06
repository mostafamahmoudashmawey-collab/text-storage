const fetch = require('node-fetch');

async function getSchema() {
  try {
    const res = await fetch('https://wesxjexuycdstmofcqim.supabase.co/rest/v1/?apikey=sb_publishable_P8oFAOEotsadARTUYZAVGw_STgiZcLG', {
      headers: {
        'Authorization': 'Bearer sb_publishable_P8oFAOEotsadARTUYZAVGw_STgiZcLG'
      }
    });
    const data = await res.json();
    console.log(JSON.stringify(data.definitions, null, 2));
  } catch (e) {
    console.error(e);
  }
}
getSchema();
