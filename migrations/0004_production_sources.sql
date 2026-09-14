UPDATE sources
SET interval_minutes = 60,
    updated_at = CURRENT_TIMESTAMP
WHERE url IN (
  'https://github.com/codertesla/ai-coding-deals',
  'https://github.com/llerandi/llm-price-tracker',
  'https://github.com/xiaotiewinner/coding-plan'
);

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'DeepSeek API Pricing','https://api-docs.deepseek.com/quick_start/pricing/','web','A',120,NULL,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://api-docs.deepseek.com/quick_start/pricing/');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'Zhipu BigModel Pricing','https://open.bigmodel.cn/pricing','web','A',120,NULL,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://open.bigmodel.cn/pricing');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'MiniMax API Pricing','https://platform.minimaxi.com/docs/guides/pricing-paygo','web','A',180,NULL,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://platform.minimaxi.com/docs/guides/pricing-paygo');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'Kimi API Pricing','https://platform.kimi.ai/docs/pricing/chat','web','A',180,NULL,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://platform.kimi.ai/docs/pricing/chat');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'OpenCode Releases','https://github.com/opencode-ai/opencode','github','A',60,
       '{"githubOwner":"opencode-ai","githubRepo":"opencode","githubMode":"releases","githubBranch":"main"}',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://github.com/opencode-ai/opencode');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'HN AI Free Credits','https://hnrss.org/newest?q=AI%20API%20free%20credits','rss','C',60,NULL,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://hnrss.org/newest?q=AI%20API%20free%20credits');
