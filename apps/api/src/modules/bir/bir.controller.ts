import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Bir module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("bir")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("bir")
export class BirController {
  @Get("_status")
  status() {
    return { module: "bir", status: "stub" };
  }
}
