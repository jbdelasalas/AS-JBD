import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Fuel module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("fuel")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("fuel")
export class FuelController {
  @Get("_status")
  status() {
    return { module: "fuel", status: "stub" };
  }
}
