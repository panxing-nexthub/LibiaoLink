-- LibiaoLink · 0124 单聊欢迎语一次性登记（2026-11-26 · 只加不改）
-- 口径：智能机器人单聊 `enter_chat` 欢迎语对同一 (bot_id, wecom_userid) 只回一次 —— 用户反复点开机器人
--   不再重复问候。与激活 / 绑定语义完全解耦：不写 wecom_aibot_dm_activations，不影响 846607 判据与寻址。
-- 变更：
--   1. wecom_aibot_welcome_sent —— 欢迎语已发送登记（主键 = bot_id + wecom_userid；行存在 = 已发过）。
-- 回滚（如需）：
--   drop table if exists wecom_aibot_welcome_sent;

create table wecom_aibot_welcome_sent (
  bot_id text not null,
  wecom_userid text not null,
  sent_at timestamptz not null default now(),
  constraint pk_wecom_aibot_welcome_sent primary key (bot_id, wecom_userid),
  constraint ck_wecom_aibot_welcome_sent_userid check (wecom_userid ~ '^[A-Za-z0-9_.@-]{1,64}$')
);

comment on table wecom_aibot_welcome_sent is '单聊欢迎语一次性登记（2026-11-26）：同一 (bot_id, wecom_userid) 只回一次 enter_chat 欢迎语；与激活 / 绑定无关';

grant select, insert, update, delete on wecom_aibot_welcome_sent to libiaolink_api;
grant select on wecom_aibot_welcome_sent to libiaolink_readonly;
