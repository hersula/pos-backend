-- AlterTable
ALTER TABLE `warehouses` ADD COLUMN `customer_id` VARCHAR(191) NULL,
    ADD COLUMN `type` ENUM('STORE', 'CONSIGNMENT') NOT NULL DEFAULT 'STORE';

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `consignment_order_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `consignment_orders` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `consignment_no` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `source_warehouse_id` VARCHAR(191) NOT NULL,
    `consign_warehouse_id` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'PARTIALLY_SETTLED', 'SETTLED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `sent_at` DATETIME(3) NULL,
    `due_date` DATETIME(3) NULL,
    `note` TEXT NULL,
    `cancel_reason` TEXT NULL,
    `created_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `consignment_orders_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `consignment_orders_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    UNIQUE INDEX `consignment_orders_tenant_id_consignment_no_key`(`tenant_id`, `consignment_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consignment_items` (
    `id` VARCHAR(191) NOT NULL,
    `consignment_order_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `product_unit_id` VARCHAR(191) NULL,
    `unit_label` VARCHAR(191) NULL,
    `conversion_qty_snapshot` INTEGER NOT NULL DEFAULT 1,
    `qty_sent` INTEGER NOT NULL,
    `base_qty_sent` INTEGER NOT NULL,
    `base_qty_sold` INTEGER NOT NULL DEFAULT 0,
    `base_qty_returned` INTEGER NOT NULL DEFAULT 0,
    `agreed_unit_price` DECIMAL(14, 2) NOT NULL,

    INDEX `consignment_items_consignment_order_id_idx`(`consignment_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consignment_settlements` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `consignment_order_id` VARCHAR(191) NOT NULL,
    `type` ENUM('SALE', 'RETURN') NOT NULL,
    `sale_id` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `voided_at` DATETIME(3) NULL,
    `created_by_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lines` JSON NOT NULL,

    UNIQUE INDEX `consignment_settlements_sale_id_key`(`sale_id`),
    INDEX `consignment_settlements_tenant_id_consignment_order_id_idx`(`tenant_id`, `consignment_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `warehouses_tenant_id_type_idx` ON `warehouses`(`tenant_id`, `type`);

-- CreateIndex
CREATE UNIQUE INDEX `warehouses_tenant_id_customer_id_type_key` ON `warehouses`(`tenant_id`, `customer_id`, `type`);

-- CreateIndex
CREATE INDEX `sales_consignment_order_id_idx` ON `sales`(`consignment_order_id`);

-- AddForeignKey
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_consignment_order_id_fkey` FOREIGN KEY (`consignment_order_id`) REFERENCES `consignment_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_orders` ADD CONSTRAINT `consignment_orders_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_orders` ADD CONSTRAINT `consignment_orders_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_orders` ADD CONSTRAINT `consignment_orders_source_warehouse_id_fkey` FOREIGN KEY (`source_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_orders` ADD CONSTRAINT `consignment_orders_consign_warehouse_id_fkey` FOREIGN KEY (`consign_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_items` ADD CONSTRAINT `consignment_items_consignment_order_id_fkey` FOREIGN KEY (`consignment_order_id`) REFERENCES `consignment_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_items` ADD CONSTRAINT `consignment_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_settlements` ADD CONSTRAINT `consignment_settlements_consignment_order_id_fkey` FOREIGN KEY (`consignment_order_id`) REFERENCES `consignment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consignment_settlements` ADD CONSTRAINT `consignment_settlements_sale_id_fkey` FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

