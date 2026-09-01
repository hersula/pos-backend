-- CreateTable
CREATE TABLE `role_menu_permissions` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'MANAGER', 'KASIR', 'GUDANG', 'AKUNTAN') NOT NULL,
    `menu_key` VARCHAR(191) NOT NULL,
    `can_access` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `role_menu_permissions_tenant_id_role_menu_key_key`(`tenant_id`, `role`, `menu_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_menu_permissions` ADD CONSTRAINT `role_menu_permissions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
