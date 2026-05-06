import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wesxjexuycdstmofcqim.supabase.co';
const supabaseKey = 'sb_publishable_P8oFAOEotsadARTUYZAVGw_STgiZcLG';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSupabase() {
  let tables = ['Texts', 'text', 'Text', 'my_table', 'data', 'items', 'Users', 'user', 'user_table'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log(t, ":", error.message);
    } else {
      console.log("FOUND TABLE:", t, data);
    }
  }
}

testSupabase();
