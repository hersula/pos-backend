-- AlterTable
ALTER TABLE `purchase_orders` ADD COLUMN `paid_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `payment_method` ENUM('CASH', 'CREDIT', 'TRANSFER') NOT NULL DEFAULT 'CASH',
    ADD COLUMN `payment_status` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID';

-- CreateTable
CREATE TABLE `purchase_payments` (
    `id` VARCHAR(191) NOT NULL,
    `purchase_order_id` VARCHAR(191) NOT NULL,
    `method` ENUM('CASH', 'CREDIT', 'TRANSFER') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `reference_no` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchase_payments` ADD CONSTRAINT `purchase_payments_purchase_order_id_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
