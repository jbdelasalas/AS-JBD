import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Ar module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("ar")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("ar")
export class ArController {
  @Get("_status")
  status() {
    return { module: "ar", status: "stub" };
  }
}
