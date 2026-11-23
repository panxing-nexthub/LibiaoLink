-- 企微授权卡与项目只读授权。绑定换群时轮换 access_epoch，使旧卡和旧授权失效。
alter table wecom_groups add column access_epoch uuid not null default gen_random_uuid();

create table wecom_project_access_cards (
  id          uuid primary key,
  group_id    bigint not null references wecom_groups(id) on delete cascade,
  group_epoch uuid not null,
  bot_id      text not null,
  issued_by   uuid not null references users(id),
  expires_at  timestamptz not null
);
create index ix_wecom_project_access_cards_group on wecom_project_access_cards (group_id);

create table wecom_project_read_grants (
  group_id      bigint not null references wecom_groups(id) on delete cascade,
  group_epoch   uuid not null,
  user_id       uuid not null references users(id),
  activation_id bigint not null references wecom_aibot_dm_activations(id) on delete cascade,
  card_id       uuid not null references wecom_project_access_cards(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (group_id, group_epoch, user_id)
);
create unique index uq_wecom_project_read_grants_card_actor on wecom_project_read_grants (card_id, activation_id);
create index ix_wecom_project_read_grants_user on wecom_project_read_grants (user_id);
