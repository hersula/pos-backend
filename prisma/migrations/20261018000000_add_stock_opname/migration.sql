-- CreateTable
CREATE TABLE `stock_opnames` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `opname_no` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `category_id` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `note` TEXT NULL,
    `cancel_reason` TEXT NULL,
    `created_by_id` VARCHAR(191) NOT NULL,
    `completed_by_id` VARCHAR(191) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `stock_opnames_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `stock_opnames_tenant_id_warehouse_id_idx`(`tenant_id`, `warehouse_id`),
    UNIQUE INDEX `stock_opnames_tenant_id_opname_no_key`(`tenant_id`, `opname_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_opname_items` (
    `id` VARCHAR(191) NOT NULL,
    `stock_opname_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `system_qty` INTEGER NOT NULL,
    `counted_qty` INTEGER NULL,
    `diff` INTEGER NOT NULL DEFAULT 0,
    `unit_cost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `diff_value` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    `stock_before_finalize` INTEGER NULL,
    `applied_diff` INTEGER NULL,
    `counted_at` DATETIME(3) NULL,
    `counted_by_id` VARCHAR(191) NULL,

    INDEX `stock_opname_items_product_id_idx`(`product_id`),
    UNIQUE INDEX `stock_opname_items_stock_opname_id_product_id_key`(`stock_opname_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stock_opnames` ADD CONSTRAINT `stock_opnames_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_opnames` ADD CONSTRAINT `stock_opnames_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_opname_items` ADD CONSTRAINT `stock_opname_items_stock_opname_id_fkey` FOREIGN KEY (`stock_opname_id`) REFERENCES `stock_opnames`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_opname_items` ADD CONSTRAINT `stock_opname_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

