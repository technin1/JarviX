// Cliente Supabase do FRONTEND — usa a "anon key", que é feita pra ser
// pública (fica no código do navegador). NUNCA coloque a service_role key
// aqui; ela só pode viver no backend/ai-core, em servidor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Preencha com os valores do seu projeto (Project Settings > API).
// Diferente do .env do backend, isto roda no navegador — não tem como
// "esconder" essa URL/anon key do usuário final, e não precisa: elas são
// protegidas pelas regras de RLS (Row Level Security) no banco, não por sigilo.
const SUPABASE_URL = "https://axjvshgpoqrplahekuql.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4anZzaGdwb3FycGxhaGVrdXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzYyOTAsImV4cCI6MjA5OTU1MjI5MH0.vDIS0N3deKX2C22AYKF4Ql0V76WeuX77uXRmsLcAMNY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
