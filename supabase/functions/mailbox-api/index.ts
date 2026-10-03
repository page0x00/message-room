import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {apiHandler} from './handler.js';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(apiHandler({admin,env:(key:string)=>Deno.env.get(key)}));
