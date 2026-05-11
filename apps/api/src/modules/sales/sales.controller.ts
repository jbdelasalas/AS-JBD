import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Sales module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("sales")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("sales")
export class SalesController {
  @Get("_status")
  status() {
    return { module: "sales", status: "stub" };
  }
}
