// اتصال به Supabase از طریق CDN (بدون نیاز به npm/build) — جایگزین firebase-config.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export const SUPABASE_URL = "https://zekbzjefidezmgypfpxh.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_rK84qylcx1A2MQ3JmSrKZQ_cjFQ61fa";
export const ADMIN_UID = "6068e9f8-38cf-403e-8adf-466cfa9502bf";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
