-- AgenTeam rename (was Agentself): the data folder ~/.agentself became ~/.agenteam, so every workspace path that
-- Paperclip saved under it moves with it. Without this a task's inherited execution workspace can no longer be
-- restored and its next run fails at setup. Only a whole path segment named ".agentself" changes (either slash style;
-- in the JSON text of adapter_config a Windows separator is "\\", which the same pattern covers).
UPDATE "execution_workspaces"
SET "cwd" = regexp_replace("cwd", '([/\\])\.agentself([/\\]|$)', '\1.agenteam\2', 'g'),
    "provider_ref" = regexp_replace("provider_ref", '([/\\])\.agentself([/\\]|$)', '\1.agenteam\2', 'g')
WHERE "cwd" ~ '[/\\]\.agentself([/\\]|$)' OR "provider_ref" ~ '[/\\]\.agentself([/\\]|$)';--> statement-breakpoint
UPDATE "project_workspaces"
SET "cwd" = regexp_replace("cwd", '([/\\])\.agentself([/\\]|$)', '\1.agenteam\2', 'g')
WHERE "cwd" ~ '[/\\]\.agentself([/\\]|$)';--> statement-breakpoint
UPDATE "workspace_runtime_services"
SET "cwd" = regexp_replace("cwd", '([/\\])\.agentself([/\\]|$)', '\1.agenteam\2', 'g')
WHERE "cwd" ~ '[/\\]\.agentself([/\\]|$)';--> statement-breakpoint
UPDATE "execution_workspace_repository_roots"
SET "canonical_cwd" = regexp_replace("canonical_cwd", '([/\\])\.agentself([/\\]|$)', '\1.agenteam\2', 'g')
WHERE "canonical_cwd" ~ '[/\\]\.agentself([/\\]|$)';--> statement-breakpoint
UPDATE "agents"
SET "adapter_config" = regexp_replace("adapter_config"::text, '([/\\])\.agentself([/\\"]|$)', '\1.agenteam\2', 'g')::jsonb
WHERE "adapter_config"::text ~ '[/\\]\.agentself([/\\"]|$)';
