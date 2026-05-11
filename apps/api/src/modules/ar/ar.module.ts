import { Module } from "@nestjs/common";
import { ArController } from "./ar.controller";

@Module({
  controllers: [ArController],
})
export class ArModule {}
