INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'AI Coding Deals','https://github.com/codertesla/ai-coding-deals','github','B',10,
       '{"githubOwner":"codertesla","githubRepo":"ai-coding-deals","githubMode":"commits","githubBranch":"main"}',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://github.com/codertesla/ai-coding-deals');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'LLM Price Tracker','https://github.com/llerandi/llm-price-tracker','github','B',15,
       '{"githubOwner":"llerandi","githubRepo":"llm-price-tracker","githubMode":"commits","githubBranch":"main"}',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://github.com/llerandi/llm-price-tracker');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'Free LLM API Resources','https://github.com/cheahjs/free-llm-api-resources','github','B',15,
       '{"githubOwner":"cheahjs","githubRepo":"free-llm-api-resources","githubMode":"commits","githubBranch":"main"}',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://github.com/cheahjs/free-llm-api-resources');

INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at)
SELECT 'Coding Plan CN','https://github.com/xiaotiewinner/coding-plan','github','B',15,
       '{"githubOwner":"xiaotiewinner","githubRepo":"coding-plan","githubMode":"commits","githubBranch":"main"}',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE url='https://github.com/xiaotiewinner/coding-plan');
