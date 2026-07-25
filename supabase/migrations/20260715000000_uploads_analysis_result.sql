-- Adiciona coluna para guardar o resultado da análise assíncrona de uploads
-- (processada pelo uploadWorker.js via fila BullMQ).
alter table public.uploads
  add column if not exists analysis_result text;
