import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wesxjexuycdstmofcqim.supabase.co';
const supabaseKey = 'sb_publishable_P8oFAOEotsadARTUYZAVGw_STgiZcLG';

export const supabase = createClient(supabaseUrl, supabaseKey);
