import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Users module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("users")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("users")
export class UsersController {
  @Get("_status")
  status() {
    return { module: "users", status: "stub" };
  }
}
