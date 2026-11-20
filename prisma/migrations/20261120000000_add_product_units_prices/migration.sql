-- Tabel & kolom ini sudah lama ada di schema.prisma (fitur satuan & harga per level),
-- tapi tidak pernah dibuatkan migrasinya. Isi diambil dari `prisma migrate diff`
-- terhadap database produksi.

-- AlterTable
ALTER TABLE `purchase_order_items` ADD COLUMN `conversion_qty` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `product_unit_id` VARCHAR(191) NULL,
    ADD COLUMN `unit_label` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `sale_items` ADD COLUMN `conversion_qty` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `product_unit_id` VARCHAR(191) NULL,
    ADD COLUMN `unit_label` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `price_levels` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_prices` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `price_level_id` VARCHAR(191) NOT NULL,
    `sell_price` DECIMAL(14, 2) NOT NULL,

    UNIQUE INDEX `product_prices_product_id_price_level_id_key`(`product_id`, `price_level_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_units` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `product_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `conversion_qty` INTEGER NOT NULL,
    `sell_price` DECIMAL(14, 2) NOT NULL,
    `barcode` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `price_levels` ADD CONSTRAINT `price_levels_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_prices` ADD CONSTRAINT `product_prices_price_level_id_fkey` FOREIGN KEY (`price_level_id`) REFERENCES `price_levels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_units` ADD CONSTRAINT `product_units_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_product_unit_id_fkey` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_product_unit_id_fkey` FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
