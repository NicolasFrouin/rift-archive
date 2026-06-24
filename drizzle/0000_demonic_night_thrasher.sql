CREATE TABLE IF NOT EXISTS "matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"raw" jsonb NOT NULL,
	"game_creation" timestamp with time zone,
	"queue_id" integer,
	"game_version" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_matches" (
	"puuid" text NOT NULL,
	"match_id" text NOT NULL,
	CONSTRAINT "player_matches_puuid_match_id_pk" PRIMARY KEY("puuid","match_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"puuid" text NOT NULL,
	"platform" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"backfill_done" boolean DEFAULT false NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_puuid_unique" UNIQUE("puuid")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_game_creation_idx" ON "matches" USING btree ("game_creation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_queue_id_idx" ON "matches" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_matches_match_id_idx" ON "player_matches" USING btree ("match_id");