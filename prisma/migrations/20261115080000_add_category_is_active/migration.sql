-- AlterTable
ALTER TABLE `categories`
    ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX `categories_tenant_id_is_active_idx` ON `categories`(`tenant_id`, `is_active`);
