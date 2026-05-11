import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Reports module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("reports")
export class ReportsController {
  @Get("_status")
  status() {
    return { module: "reports", status: "stub" };
  }
}
