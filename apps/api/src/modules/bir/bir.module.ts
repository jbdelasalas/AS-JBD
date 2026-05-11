import { Module } from "@nestjs/common";
import { BirController } from "./bir.controller";

@Module({
  controllers: [BirController],
})
export class BirModule {}
