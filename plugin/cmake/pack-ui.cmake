# Copies the built renderer without source maps, downloaded kits or the acoustic set (the app
# packs those apart from the screen too) and zips it: cmake -DSRC= -DSTAGE= -DOUT= -P pack-ui.cmake
file(REMOVE_RECURSE "${STAGE}")
file(COPY "${SRC}/" DESTINATION "${STAGE}" PATTERN "*.map" EXCLUDE PATTERN "kits" EXCLUDE PATTERN "acoustic" EXCLUDE)
file(REMOVE "${OUT}")
file(GLOB_RECURSE entries RELATIVE "${STAGE}" "${STAGE}/*")
execute_process(COMMAND ${CMAKE_COMMAND} -E tar cf "${OUT}" --format=zip ${entries} WORKING_DIRECTORY "${STAGE}" RESULT_VARIABLE r)
if(NOT r EQUAL 0)
  message(FATAL_ERROR "Could not pack the screen: ${r}")
endif()
