-- CreateTable
CREATE TABLE `app_versions` (
    `id` VARCHAR(191) NOT NULL,
    `platform` ENUM('ANDROID', 'IOS') NOT NULL DEFAULT 'ANDROID',
    `version` VARCHAR(191) NOT NULL,
    `buildNumber` INTEGER NOT NULL,
    `min_supported_version` VARCHAR(191) NOT NULL,
    `mandatory` BOOLEAN NOT NULL DEFAULT false,
    `download_url` TEXT NOT NULL,
    `release_notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `released_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `app_versions_platform_is_active_buildNumber_idx`(`platform`, `is_active`, `buildNumber`),
    UNIQUE INDEX `app_versions_platform_buildNumber_key`(`platform`, `buildNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
