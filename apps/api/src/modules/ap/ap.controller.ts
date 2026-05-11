import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Ap module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("ap")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("ap")
export class ApController {
  @Get("_status")
  status() {
    return { module: "ap", status: "stub" };
  }
}
