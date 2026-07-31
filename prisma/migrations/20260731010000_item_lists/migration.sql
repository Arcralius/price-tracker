-- CreateTable
CREATE TABLE "ItemList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ItemListToTrackedItem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ItemListToTrackedItem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "ItemList_userId_idx" ON "ItemList"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemList_userId_name_key" ON "ItemList"("userId", "name");

-- CreateIndex
CREATE INDEX "_ItemListToTrackedItem_B_index" ON "_ItemListToTrackedItem"("B");

-- AddForeignKey
ALTER TABLE "ItemList" ADD CONSTRAINT "ItemList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemListToTrackedItem" ADD CONSTRAINT "_ItemListToTrackedItem_A_fkey" FOREIGN KEY ("A") REFERENCES "ItemList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemListToTrackedItem" ADD CONSTRAINT "_ItemListToTrackedItem_B_fkey" FOREIGN KEY ("B") REFERENCES "TrackedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

