ALTER TABLE sources ADD COLUMN source_tier TEXT NOT NULL DEFAULT 'core';
ALTER TABLE sources ADD COLUMN discovered_from_source_id INTEGER;
ALTER TABLE sources ADD COLUMN expires_at TEXT;
ALTER TABLE sources ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sources_tier_expiry ON sources(source_tier, enabled, expires_at);

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at,source_tier)
SELECT 'OpenRouter Model Discovery','https://openrouter.ai/api/v1/models','web','B',60,
       '{"sourceTier":"discovery","discoveryProvider":"openrouter_models"}',CURRENT_TIMESTAMP,'discovery'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://openrouter.ai/api/v1/models');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at,source_tier)
SELECT 'Hugging Face Trending LLM Discovery','https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trendingScore&direction=-1&limit=30','web','B',120,
       '{"sourceTier":"discovery","discoveryProvider":"huggingface_models"}',CURRENT_TIMESTAMP,'discovery'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trendingScore&direction=-1&limit=30');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at,source_tier)
SELECT 'Artificial Analysis Model Discovery','https://artificialanalysis.ai/models','web','B',120,
       '{"sourceTier":"discovery","discoveryProvider":"artificial_analysis_models"}',CURRENT_TIMESTAMP,'discovery'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://artificialanalysis.ai/models');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at,source_tier)
SELECT 'Multiverse Computing Resources','https://multiversecomputing.com/resources','web','A',120,
       '{"sourceTier":"core"}',CURRENT_TIMESTAMP,'core'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://multiversecomputing.com/resources');
