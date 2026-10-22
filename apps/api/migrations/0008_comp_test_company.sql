-- Sprite Labs is the company of the TestSprite account that runs the whole live suite against lucidhire.io several
-- times a day. Each run posts and deletes about fifteen jobs, which the Free plan's 10 new jobs a month would stop
-- after the first run. It is comped to Max: no Polar subscription, and a paid period that does not end. A no-op on
-- any other database.
UPDATE `organizations`
SET `plan` = 'max', `subscription_status` = 'active', `current_period_end` = 4102444800000
WHERE `id` = 'ba8622a3-de12-4458-a704-d3cea5bcfbaa';
