import { Module } from "@nestjs/common";
import { ApController } from "./ap.controller";

@Module({
  controllers: [ApController],
})
export class ApModule {}
