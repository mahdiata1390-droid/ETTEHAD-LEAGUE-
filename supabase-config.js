// اتصال به Supabase از طریق CDN (بدون نیاز به npm/build) — جایگزین firebase-config.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://zekbzjefidezmgypfpxh.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_rK84qylcx1A2MQ3JmSrKZQ_cjFQ61fa";
export const ADMIN_UID = "f3a1c2b4-9e21-4a6d-8b3f-1234567890ab";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
