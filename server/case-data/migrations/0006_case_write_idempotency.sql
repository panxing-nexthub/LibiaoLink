create table "case".case_idempotency_keys (
  client_id text not null,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status_code smallint not null check (status_code in (200, 201, 404, 409, 422)),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  resource_id uuid,
  created_at timestamptz not null default transaction_timestamp(),
  expires_at timestamptz not null default transaction_timestamp() + interval '30 days',
  primary key (client_id, operation_id)
);

grant select, insert on "case".case_idempotency_keys to case_gateway_authoring_rw;
