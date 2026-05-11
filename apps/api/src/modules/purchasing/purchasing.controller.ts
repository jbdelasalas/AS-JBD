import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Purchasing module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("purchasing")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("purchasing")
export class PurchasingController {
  @Get("_status")
  status() {
    return { module: "purchasing", status: "stub" };
  }
}
